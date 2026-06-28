# Passwordless email login (6-digit code) with history merge

## Context

Today identity is purely the per-browser `ss_uid` cookie → one `users` row (`get_or_create_user`), with the token stored **on the users row** (`users.cookie_token`). Clear the cookie or switch browsers and the like/dislike/click history is gone. We want users to **claim a durable identity via email** so they carry their history across browsers and recover it after a cookie is dropped.

Auth is **passwordless and code-only**: enter email → receive a fresh **6-digit code** by email → enter the code → logged in. No password, no "remember this device" — every login mints a new single-use code.

On login, when the current browser already has an **anonymous** history and the account also has history, they are **merged** and — per the user's decision — **the account's existing history is authoritative**: on a like/dislike conflict the account's stored vote is kept; the incoming browser only fills in items the account hasn't voted on. Clicks (append-only) are always carried over.

No email infra exists; we add a small nodemailer/SMTP sender.

## Key model change: many tokens → one account

The current "one `cookie_token` per `users` row" model can't represent one account open in several browsers. **Each browser keeps its own token; multiple tokens map to one account.** So we move tokens off the `users` row into a `tokens` table, and `users` becomes the durable identity (with an optional `email`). Login points **this browser's token** at the account's `users.id`.

## Migrations (append-only, `src/lib/db/migrations.ts`; latest shipped is v10)

- **v11 `add_user_email`** — `ALTER TABLE users ADD COLUMN email TEXT;` + `CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;` (partial: many NULLs, emails unique). `email TEXT` is valid on the STRICT table; existing rows get NULL.
- **v12 `add_tokens`** —
  ```sql
  CREATE TABLE tokens (
    token          TEXT PRIMARY KEY,
    user_id        INTEGER NOT NULL REFERENCES users(id),
    created_at     INTEGER NOT NULL,
    last_active_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX idx_tokens_user ON tokens(user_id);
  CREATE INDEX idx_tokens_last_active ON tokens(last_active_at);
  INSERT INTO tokens (token, user_id, created_at, last_active_at)
    SELECT cookie_token, id, created_at, last_active_at FROM users WHERE cookie_token IS NOT NULL;
  ALTER TABLE users DROP COLUMN cookie_token;   -- runner disables FKs around migrations
  ```
- **v13 `add_login_codes`** —
  ```sql
  CREATE TABLE login_codes (
    email      TEXT NOT NULL PRIMARY KEY,   -- one active code per email; upsert replaces
    code       TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  ```

Follow existing rules: no `BEGIN/COMMIT`, runner owns the transaction, never edit a shipped migration.

## DB layer

Hand-written prepared statements per call — no module-level statement cache (see [[prefer-fixing-prod-code-over-test-workarounds]]).

### Rework `src/lib/db/users.ts` (token now lives in `tokens`)

- `get_or_create_user(token): number` — `SELECT user_id FROM tokens WHERE token=?`; if found, touch `tokens.last_active_at` (and `users.last_active_at`) and return `user_id`; else `INSERT` an anonymous `users` row, `INSERT` the `tokens` row, return the new id. (Unknown token still auto-creates an anonymous user, as today.)
- `cleanup_inactive_users()` — now `DELETE FROM tokens WHERE last_active_at < cutoff`. Parity with today: history rows are left intact (previously the token was merely nulled). Keep the once-per-hour throttle and `INACTIVITY_DAYS` cutoff. Grep for any other `cookie_token` reader before deleting the column.

### New `src/lib/db/auth.ts` (re-export from `src/lib/db/index.ts`)

- `create_login_code(email): string` — normalize email (trim+lowercase), generate a 6-digit code (`000000`–`999999`, zero-padded) via `crypto.getRandomValues`, upsert into `login_codes` (`ON CONFLICT(email) DO UPDATE`) with `expires_at = now + 15min`. Returns the code. Optional gentle throttle: reject if an unexpired code was created < 60s ago.
- `verify_login_code(email, code): boolean` — match normalized email + code, `expires_at > now`; on success `DELETE` the row (single-use).
- `get_user_email(user_id): string | null` — for logged-in display.
- `unlink_email(user_id)` — `UPDATE users SET email = NULL WHERE id = ?` (used by revoke; see below).
- `attach_login(email, current_token, new_token): string` — one transaction; returns the **token to set in the browser cookie**. Resolve `current_uid` (+ its email) from `tokens WHERE token=current_token`, and `account_uid` from `users WHERE email`:

  | Case | Condition | Action |
  |---|---|---|
  | Already this account | `current_uid === account_uid` | keep `current_token` (or create `new_token`→account); return it |
  | Merge anon → account | account exists, `current` anonymous (`email IS NULL`), differs | **merge** (below), then return this browser's token |
  | Switch accounts | account exists, `current` has its own email | repoint only this browser's token to account; no merge/delete; return token |
  | No current token | account exists, `current_uid` null | create `new_token`→account; return `new_token` |
  | First login (promote) | no account, `current` anonymous | `UPDATE users SET email=$email WHERE id=current_uid`; return `current_token` |
  | First login (fresh) | no account, no/other-email current | `INSERT` user(email) + token(`new_token`); return `new_token` |

  **Merge** (account-authoritative; repoints *all* of the anon user's tokens so every browser on that anon identity follows the account):
  ```sql
  INSERT INTO user_items (user_id, item_id, like, updated_at)
  SELECT $account, item_id, like, updated_at FROM user_items WHERE user_id=$current
  ON CONFLICT(user_id,item_id) DO NOTHING;          -- account keeps its vote on conflict
  UPDATE user_clicks SET user_id=$account WHERE user_id=$current;
  UPDATE tokens      SET user_id=$account WHERE user_id=$current;
  DELETE FROM user_items WHERE user_id=$current;
  DELETE FROM users      WHERE id=$current;          -- children moved first; FKs satisfied
  ```
  In the "no current token" / "fresh" cases the action passes a freshly generated `new_token`; otherwise the current browser already has a token row (now pointed at the account).

## Email — new `src/lib/email.ts`

`send_login_code(email, code)` using **nodemailer** (add `nodemailer` + `@types/nodemailer`). Lazily build a transporter from `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. If unset (local dev), log the code to the server console and skip sending so the flow is testable without SMTP. Plain-text body with the code and a 15-minute expiry note.

## Server actions (`src/app/actions.ts`)

- `request_login_code(email): { ok, error? }` — validate email shape, `create_login_code`, `send_login_code`. Return `{ ok: true }` even for unknown emails (don't reveal which exist); only surface format errors.
- `submit_login_code(email, code): { ok, error? }` — `verify_login_code`; on success read the existing `ss_uid` cookie value (may be undefined), `const token = attach_login(email, current_token, crypto.randomUUID())`, then set cookies like `grant_consent`: `store.set(COOKIE_NAME, token, cookie_options())` and `store.set(CONSENT_COOKIE, 'granted', consent_cookie_options())` (login implies consent). Bad/expired code → `{ ok:false, error }`.
- `logout(): void` — mint a fresh anonymous identity: `const token = crypto.randomUUID(); store.set(COOKIE_NAME, token, cookie_options()); get_or_create_user(token)`. Keep consent granted; the account persists, reachable by email/other browsers.
- `get_current_account(): { email } | null` — `current_user_id()` → `get_user_email(uid)`.

### Revoke = delete the account (per user)

Update **`revoke_consent`**: resolve `current_user_id()`; if that user has an email, call `unlink_email(uid)` (removes the email — **nothing else**, history rows stay). Then keep the existing behavior: set `ss_consent='denied'` and delete the `ss_uid` cookie. After this the identity is anonymous again and can't be recovered by email.

## Client UI

New `src/components/Account.tsx` mirroring `CookieConsent.tsx`'s context+provider pattern:

- `AuthProvider` → `useAuth()` = `{ account, openLogin, logout, refreshAccount }`; on mount calls `get_current_account()`.
- `LoginDialog` — MUI `Dialog` + `TextField` (new to the codebase but standard MUI; `sx`-only styling). Two steps: email → `request_login_code`; 6-digit code (numeric input) → `submit_login_code`. On success: close, then **`window.location.reload()`** so `ConsentProvider` re-initializes from the now-`granted` consent cookie (its state is cookie-seeded once at mount). Inline error on invalid code.
- `src/components/App.tsx`: provider order **`AuthProvider` → `ConsentProvider` → `FeedProvider`** so `CookieConsent` (inner) can read `useAuth()` for the delete-warning.
- `src/components/WikiArticles.tsx` drawer: add a `Divider` + entry — logged out: "Log in" → `openLogin()`; logged in: show the email + "Log out" → `logout()` + reload.
- `src/components/CookieConsent.tsx`: when `useAuth().account` is set, the "Withdraw consent" button first shows a confirmation warning ("This removes your account — your saved likes can no longer be recovered by email") before calling `revoke_consent`; after revoke, `refreshAccount()` + reload.

## Docs

Update `CLAUDE.md`: "Users, cookies & consent" (tokens table / many-tokens-per-account, email login, account-wins merge, revoke deletes the email, login implies consent) and the feature-flags table (`SMTP_*`). Add `SMTP_*` to `.env.example`.

## Critical files

- `src/lib/db/migrations.ts` — v11, v12, v13
- `src/lib/db/users.ts` — rework for `tokens` table; `src/lib/db/auth.ts` (new) + `src/lib/db/index.ts` re-export
- `src/lib/email.ts` (new)
- `src/app/actions.ts` — new actions + `revoke_consent` change
- `src/components/Account.tsx` (new), `App.tsx`, `WikiArticles.tsx`, `CookieConsent.tsx`
- `package.json` (nodemailer), `.env.example`, `CLAUDE.md`

## Edge cases handled

- Anonymous browser → existing account: merge, account wins conflicts, clicks carried, all anon tokens repointed, anon row deleted.
- Brand-new browser (no cookie) → existing account: adopt account, no merge.
- First-ever login for an email from an anonymous browser: that row is promoted (email attached), history kept; **token row preserved** (browser stays logged in).
- Switching between two real accounts: repoint this browser's token only, no destructive merge.
- Same account in two browsers: two `tokens` rows → one `users.id`.
- Expired tokens cleaned up; account `users` row + history survive and are reachable by re-login.
- Signed-in user revokes consent: warning, then email nulled (account deleted), history rows left as-is.
- Codes single-use, 15-min expiry, one active per email (upsert), 6 digits.

## Verification

- `npm run check`, then `npm run check-fix` (per CLAUDE.md, after type-check passes).
- **Unit (Jest, `tests/`)**: `create_login_code`/`verify_login_code` (valid, wrong, expired, single-use); migration upgrade moves `cookie_token`→`tokens`; `get_or_create_user` against the tokens table; `attach_login` for every row in the table above — assert account vote wins on conflict, anon-only items merged, `user_clicks` + all `tokens` repointed, anon `users` row deleted, promote attaches email, fresh insert path; `unlink_email` nulls email and leaves history.
- **Manual**: with `SMTP_*` unset, `npm run dev`, open Login, read the 6-digit code from the server console, submit, confirm liked/disliked views reflect the account. Second browser profile: like different items, log in with the same email, confirm the account's prior likes win on overlap and new ones are added. Then revoke consent while logged in and confirm the warning, that the email is gone (can't recover), and history rows remain in the DB.
- **E2e (optional)**: Playwright spec opening the login dialog; in test env `send_login_code` exposes a deterministic code to drive step two.
