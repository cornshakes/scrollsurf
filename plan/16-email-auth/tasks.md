# Tasks: Passwordless email login with history merge

## TOC

- [x] Install nodemailer dependency [haiku]
- [x] Add migrations v11–v13 [haiku]
- [x] Rework `users.ts` for the `tokens` table [sonnet]
- [x] Create `auth.ts` with login-code and `attach_login` logic [sonnet]
- [x] Create `email.ts` [haiku]
- [x] Update `src/app/actions.ts` with new auth actions [sonnet]
- [x] Create `src/components/Account.tsx` (AuthProvider + LoginDialog) [sonnet]
- [x] Update `App.tsx` provider order [haiku]
- [x] Update `WikiArticles.tsx` drawer with login/logout entry [haiku]
- [x] Update `CookieConsent.tsx` with signed-in revoke warning [haiku]
- [x] Update `CLAUDE.md` and `.env.example` [haiku]
- [x] Write unit tests for auth layer [sonnet]

---

## 1. Install nodemailer dependency [haiku]

Add `nodemailer` and `@types/nodemailer` to `package.json`.

```
npm install nodemailer
npm install --save-dev @types/nodemailer
```

No code changes needed beyond the package files.

---

## 2. Add migrations v11–v13 [haiku]

File: `src/lib/db/migrations.ts`

Append three new migration entries after the current highest version (v10). Follow the existing format exactly — no `BEGIN/COMMIT`, runner owns the transaction.

**v11 `add_user_email`**
```sql
ALTER TABLE users ADD COLUMN email TEXT;
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
```

**v12 `add_tokens`**
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
ALTER TABLE users DROP COLUMN cookie_token;
```

**v13 `add_login_codes`**
```sql
CREATE TABLE login_codes (
  email      TEXT NOT NULL PRIMARY KEY,
  code       TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
```

---

## 3. Rework `users.ts` for the `tokens` table [sonnet]

File: `src/lib/db/users.ts`

After v12 the `cookie_token` column is gone; all token lookups now go through the new `tokens` table.

**`get_or_create_user(token): number`**
- `SELECT user_id FROM tokens WHERE token = ?`
- If found: `UPDATE tokens SET last_active_at = ? WHERE token = ?` and `UPDATE users SET last_active_at = ? WHERE id = ?`, return `user_id`.
- If not found: `INSERT INTO users (created_at, last_active_at) VALUES (?, ?)`, then `INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)`, return the new `user_id`.

**`cleanup_inactive_users()`**
- Change the cleanup target from nulling `cookie_token` to `DELETE FROM tokens WHERE last_active_at < cutoff`.
- Keep the once-per-hour throttle and `INACTIVITY_DAYS` constant.
- `users` rows and their history survive; only the stale token is removed.

Grep for any remaining `cookie_token` references before finishing and remove them.

---

## 4. Create `auth.ts` with login-code and `attach_login` logic [sonnet]

New file: `src/lib/db/auth.ts`. Re-export everything from `src/lib/db/index.ts`.

### `create_login_code(email): string`
- Normalize: `email.trim().toLowerCase()`.
- Generate a 6-digit code via `crypto.getRandomValues` (zero-pad to 6 digits).
- Optional gentle throttle: if `login_codes` has a row for this email with `created_at > now - 60s`, throw a rate-limit error.
- Upsert: `INSERT INTO login_codes ... ON CONFLICT(email) DO UPDATE SET code=excluded.code, expires_at=excluded.expires_at, created_at=excluded.created_at` with `expires_at = now + 15 * 60`.
- Return the code string.

### `verify_login_code(email, code): boolean`
- Normalize email.
- `SELECT code, expires_at FROM login_codes WHERE email = ?`.
- Return `false` if no row, wrong code, or `expires_at <= now`.
- On success: `DELETE FROM login_codes WHERE email = ?` (single-use), return `true`.

### `get_user_email(user_id): string | null`
- `SELECT email FROM users WHERE id = ?`, return `email` or `null`.

### `unlink_email(user_id): void`
- `UPDATE users SET email = NULL WHERE id = ?`.

### `attach_login(email, current_token, new_token): string`
Single transaction. Resolves `current_uid` from `tokens WHERE token = current_token` and `account_uid` from `users WHERE email = normalized_email`. Then branches:

| Case | Condition | Action | Returns |
|---|---|---|---|
| Already this account | `current_uid === account_uid` | no-op | `current_token` |
| Merge anon → account | account exists, current is anonymous (`email IS NULL`), differs | **merge** then return | `current_token` (now points at account after merge) |
| Switch accounts | account exists, current has its own email | `UPDATE tokens SET user_id = account_uid WHERE token = current_token` | `current_token` |
| No current token | account exists, `current_uid` is null | `INSERT INTO tokens (new_token, account_uid, …)` | `new_token` |
| First login – promote | no account, current is anonymous | `UPDATE users SET email = ? WHERE id = current_uid` | `current_token` |
| First login – fresh | no account, no/other-email current | `INSERT INTO users (email, …)` + `INSERT INTO tokens (new_token, …)` | `new_token` |

**Merge SQL (account-authoritative)**:
```sql
INSERT INTO user_items (user_id, item_id, like, updated_at)
  SELECT $account, item_id, like, updated_at FROM user_items WHERE user_id = $current
  ON CONFLICT(user_id, item_id) DO NOTHING;
UPDATE user_clicks SET user_id = $account WHERE user_id = $current;
UPDATE tokens      SET user_id = $account WHERE user_id = $current;
DELETE FROM user_items WHERE user_id = $current;
DELETE FROM users      WHERE id = $current;
```

---

## 5. Create `email.ts` [haiku]

New file: `src/lib/email.ts`.

```ts
import nodemailer from 'nodemailer';

export const send_login_code = async (email: string, code: string): Promise<void> => {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST) {
    console.log(`[login code] ${email}: ${code}`);
    return;
  }
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT ?? 587),
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transporter.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'Your login code',
    text: `Your login code is: ${code}\n\nIt expires in 15 minutes.`,
  });
};
```

---

## 6. Update `src/app/actions.ts` with new auth actions [sonnet]

Add four new server actions and update one existing one.

### `request_login_code(email: string): { ok: boolean; error?: string }`
- Basic email format validation (contains `@`); return `{ ok: false, error: 'Invalid email' }` if bad.
- Call `create_login_code(email)` → `code`.
- Call `send_login_code(email, code)`.
- Always return `{ ok: true }` on success (don't reveal whether the email exists).

### `submit_login_code(email: string, code: string): { ok: boolean; error?: string }`
- Call `verify_login_code(email, code)`; if false return `{ ok: false, error: 'Invalid or expired code' }`.
- Read existing `ss_uid` cookie: `const current_token = (await cookies()).get(COOKIE_NAME)?.value`.
- `const token = attach_login(email, current_token ?? null, crypto.randomUUID())`.
- Set cookies exactly as `grant_consent` does: `COOKIE_NAME → token` + `CONSENT_COOKIE → 'granted'`.
- Return `{ ok: true }`.

### `logout(): void`
- Mint a fresh anonymous token: `const token = crypto.randomUUID()`.
- `(await cookies()).set(COOKIE_NAME, token, cookie_options())`.
- `get_or_create_user(token)` (creates the anonymous row).
- Do not touch the consent cookie.

### `get_current_account(): { email: string } | null`
- `current_user_id()` → if null, return null.
- `get_user_email(uid)` → if null, return null.
- Return `{ email }`.

### Update `revoke_consent()`
After the existing consent/cookie logic, before clearing the `ss_uid` cookie:
- Resolve `current_user_id()`.
- If the user has an email (`get_user_email(uid) !== null`), call `unlink_email(uid)`.
- Then proceed with existing behavior: set `ss_consent = 'denied'` and delete `ss_uid`.

---

## 7. Create `src/components/Account.tsx` (AuthProvider + LoginDialog) [sonnet]

New file: `src/components/Account.tsx`.

**`AuthContext`** — `{ account: { email: string } | null; openLogin: () => void; logout: () => void; refreshAccount: () => Promise<void> }`.

**`AuthProvider`**
- On mount: call `get_current_account()` to populate `account`.
- `openLogin()` sets `dialogOpen = true`.
- `logout()` calls the `logout` action then `window.location.reload()`.
- `refreshAccount()` re-calls `get_current_account()` and updates state.

**`LoginDialog`** (rendered inside `AuthProvider`)
Two-step MUI `Dialog`:

Step 1 — Email:
- `TextField` (type=email), "Send code" button.
- On submit: `request_login_code(email)` → advance to step 2.

Step 2 — 6-digit code:
- `TextField` (inputMode=numeric, maxLength=6), "Verify" button.
- On submit: `submit_login_code(email, code)`.
  - On success: close dialog, `window.location.reload()`.
  - On error: show inline error message.

Back button on step 2 returns to step 1.

Export `useAuth` hook and `AuthProvider`.

---

## 8. Update `App.tsx` provider order [haiku]

File: `src/components/App.tsx`

Wrap the existing provider tree so the order is:

```
AuthProvider → ConsentProvider → FeedProvider → children
```

Import `AuthProvider` from `./Account`. No other changes.

---

## 9. Update `WikiArticles.tsx` drawer with login/logout entry [haiku]

File: `src/components/WikiArticles.tsx`

Inside the navigation drawer, after the existing list items, add a `Divider` and one more entry:

- **Logged out** (`account === null`): list item "Log in" that calls `openLogin()`.
- **Logged in**: list item showing the account email + a "Log out" sub-item or icon button that calls `logout()`.

Use `useAuth()` to read `account`, `openLogin`, and `logout`.

---

## 10. Update `CookieConsent.tsx` with signed-in revoke warning [haiku]

File: `src/components/CookieConsent.tsx`

When the user clicks "Withdraw consent" and `useAuth().account` is set:
- Show a confirmation step (e.g., MUI `Alert` or inline text) with the message: *"This removes your account — your saved likes can no longer be recovered by email."*
- Only call `revoke_consent()` after the user confirms.
- On completion: `refreshAccount()` then `window.location.reload()`.

If `account` is null, the existing behavior is unchanged (no warning).

---

## 11. Update `CLAUDE.md` and `.env.example` [haiku]

**`CLAUDE.md`** — "Users, cookies & consent" section:
- Replace the single-token description with the many-tokens model: `tokens` table, one `users` row, multiple browser tokens per account.
- Add: email login flow (6-digit code, 15-min expiry, single-use, upsert per email).
- Add: account-wins merge policy.
- Add: revoke deletes the email field only (history stays); login implies consent.

Feature-flags table — add:
| `SMTP_HOST` | (unset = log to console) | SMTP server host |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | | SMTP username |
| `SMTP_PASS` | | SMTP password |
| `SMTP_FROM` | | From address for login emails |

**`.env.example`** — add the five `SMTP_*` variables with placeholder values and a comment that leaving them unset prints the code to the console in dev.

---

## 12. Write unit tests for auth layer [sonnet]

File: `tests/auth.test.ts` (and extend `tests/users.test.ts` if needed).

Cover:

- **`create_login_code` / `verify_login_code`**
  - Valid code verifies and is then deleted (single-use).
  - Wrong code returns false.
  - Expired code (manually set `expires_at` in the past) returns false.
  - Upsert replaces a previous code for the same email.

- **Migration v12**: confirm that after running migrations the `tokens` table exists, existing `cookie_token` rows migrated correctly, and `users.cookie_token` is gone.

- **`get_or_create_user` against `tokens`**
  - Unknown token: creates a new `users` row and a `tokens` row.
  - Known token: returns existing `user_id` and updates `last_active_at`.

- **`attach_login` — one test per branch**
  - Already this account → returns `current_token`, no DB change.
  - Merge anon → account: account vote wins on conflict; anon-only items appear on account; `user_clicks` moved; all anon tokens now point to account; anon `users` row deleted.
  - Switch accounts: only this browser's token is repointed; both accounts' histories untouched.
  - No current token: `new_token` row created for account.
  - First login promote: anonymous user gets `email` set; `current_token` returned.
  - First login fresh: new `users` + `tokens` row created; `new_token` returned.

- **`unlink_email`**: sets `email = NULL`, leaves `user_items` intact.
