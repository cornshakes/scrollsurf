# E2E tests: login dialog, account switch & revoking consent while logged in

## Context

Email auth (passwordless, code-only) was recently added (`plan/16-email-auth/`) with
new components — [AuthContext.tsx](src/components/AuthContext.tsx),
[LoginDialog.tsx](src/components/LoginDialog.tsx) — and consent now interacts with
accounts in [CookieConsent.tsx](src/components/CookieConsent.tsx): withdrawing consent
while logged in *removes the account's email* (history survives but is no longer
recoverable by email re-login).

The DB layer ([src/lib/db/auth.ts](src/lib/db/auth.ts)) is thoroughly unit-tested in
[tests/auth.test.ts](tests/auth.test.ts), but there is **no e2e coverage** of the actual
UI flows: logging in through the dialog, logging out, switching accounts, and the
logged-in revoke-consent warning path. This plan adds Playwright e2e tests for those
user-facing flows.

Scope (confirmed with user): **everything** — login happy path, error cases, logout,
account switch, and re-login-after-revoke creating a fresh account.

## Guiding principle

Unit tests already prove the `attach_login` branch logic (merge/switch/promote/fresh),
`unlink_email`, code single-use/expiry/rate-limit. **Do not duplicate that here.** These
e2e tests assert only what the user sees and the cookie/state outcome: the menu showing
the right account, liked items persisting or not across login transitions, and consent
cookies flipping correctly.

## How login works in e2e (the key enabler)

SMTP is unset in e2e, so `send_login_code` just logs the code — but `create_login_code`
**also upserts the code into the `login_codes` table** ([auth.ts:31](src/lib/db/auth.ts#L31)).
A read-only DB helper can read it back, just like [db.ts](e2e/helpers/db.ts) reads
`user_clicks`. That makes a real end-to-end login flow testable without email.

## Parallelism constraint (must honor)

`playwright.config.ts` runs 4 workers across **two** projects (mobile-light, mobile-dark)
against **one shared** `e2e/.data/scrollsurf.db`. The same test runs concurrently in both
color schemes. Therefore **every test must use a unique email** (`${randomUUID()}@example.com`)
so `login_codes` rows and seeded accounts never collide between concurrent runs. Seeded
liked items are keyed `(user_id, item_id)`, so distinct users liking the same seeded
article is safe.

## Files

### 1. New helpers in `e2e/helpers/db.ts` (extend existing file)

- `read_login_code(email: string): string | null` — open read-only connection to
  `e2e/.data/scrollsurf.db`, `SELECT code FROM login_codes WHERE email = ?` (normalize
  to lowercase to match `create_login_code`). Returns null if absent.
- `get_email_for_token(token: string): string | null` — join `tokens`→`users`,
  return `users.email`. Used to assert the email was unlinked after revoke (belt-and-suspenders
  alongside the menu UI assertion).
- `seed_account(email: string, liked_url: string): void` — insert a `users` row with
  the email and a `user_items` like (=1) on the item whose `url = liked_url` (look up
  `items.id`). Used by the account-switch test to create a pre-existing target account
  with its own history. Use a `DatabaseSync` opened read/write (not readOnly) — WAL mode
  lets the dev server see the write. No token needed; `attach_login` finds the account by email.

### 2. New page/auth helpers in `e2e/helpers/pages.ts` (extend existing file)

- `login_via_dialog(page, email)`: `open_menu` → click `Log in` listitem → fill the
  `Email` textfield → click `Send code` → poll `read_login_code(email)` until present →
  fill `6-digit code` field → click `Verify`. `onSuccess` triggers `window.location.reload()`,
  so wait for the feed to re-render (`getByTestId('feed-card').first()` visible). Returns nothing.
- Reuse existing `open_menu`, `open_consent` (exported from cookies-privacy.spec — move it
  into `pages.ts` so both specs can import it), `start_consented`, `load_page`,
  `vote_card`, `find_card_by_text`, `switch_view`, `scroll_to_load_all`.

  Note: `open_consent` is currently defined and exported inside
  [cookies-privacy.spec.ts](e2e/tests/cookies-privacy.spec.ts#L4). Relocate it to
  `pages.ts` and update that spec's import (small, mechanical).

### 3. New spec `e2e/tests/auth.spec.ts`

All tests start from `load_page(page, true)` (consented anonymous) unless noted, and use
a fresh `const email = \`${randomUUID()}@example.com\``.

**describe('Login dialog')**
- `logs in via email code and shows the account in the menu` — like a known seeded
  article (e.g. `find_card_by_text(page, 'Yoga')` after `scroll_to_load_all`), then
  `login_via_dialog`. Assert: `open_menu` shows the email text and a "Log out" item;
  the liked article still appears in the Liked view (promote-anon path keeps history).
- `rejects an invalid email` — open dialog, type `not-an-email`, click `Send code`,
  assert the `Invalid email` Alert is visible and the dialog stays on the email step.
- `rejects a wrong code, then accepts the correct one` — open dialog, real email,
  `Send code`, enter `000000` (or a value guaranteed ≠ the real code — read the real code
  first and pick a different 6 digits), `Verify` → assert `Invalid or expired code` Alert;
  then fill the real code (still valid — wrong attempts don't delete it) → `Verify` →
  assert logged in via menu.
- `renders the email and code steps` (screenshots, confirmed wanted) — open the dialog and
  `toHaveScreenshot('login-dialog-email.png')`; advance to the code step (real email +
  `Send code`) and `toHaveScreenshot('login-dialog-code.png')`. Use `maxDiffPixels`
  tolerance like the consent-popover snapshots in
  [cookies-privacy.spec.ts](e2e/tests/cookies-privacy.spec.ts#L31). Target the MUI
  `Dialog` paper (e.g. `page.getByRole('dialog')`) so the screenshot is just the dialog,
  not the whole feed. The code-step text "We sent a 6-digit code to {email}" embeds the
  unique email — mask it (`mask: [page.getByText(/sent a 6-digit code/)]`) or screenshot a
  region excluding it, so the random email doesn't break the baseline. Captured in both
  mobile-light and mobile-dark.

**describe('Logout')**
- `logs out and returns to the anonymous menu` — `login_via_dialog`, confirm menu shows
  email, click "Log out" (reloads), then `open_menu` and assert the `Log in` item is back.

**describe('Account switch')**
- `switching accounts swaps the visible history` — `seed_account(other_email, YOGA_URL)`
  so account B exists with a liked "Yoga". In the browser: `login_via_dialog(page, emailA)`
  (creates/promotes A) and like a *different* seeded article (e.g. "Write amplification").
  Then `login_via_dialog(page, other_email)` → token repoints to B (switch). Assert the
  Liked view now shows B's "Yoga" and **not** A's "Write amplification" (switch does not
  merge). Menu shows `other_email`.

**describe('Revoke consent (logged in)')**
- `withdrawing consent removes the account and clears cookies` — `login_via_dialog`, then
  `open_consent` → click `Withdraw consent` → assert the warning Alert ("This removes your
  account…") and `Confirm`/`Cancel` buttons appear → click `Confirm` (triggers
  `window.location.reload()`). After reload assert: `ss_consent` cookie === `denied`,
  `ss_uid` cookie undefined (re-read via `page.context().cookies()` like
  [cookies-privacy.spec.ts](e2e/tests/cookies-privacy.spec.ts#L8)); `open_menu` shows
  `Log in` again (account gone). Optionally `get_email_for_token` is moot here since the
  token cookie is cleared — assert via the menu instead.
- `re-login after revoke creates a fresh account with no history` — capture the token,
  like an article, `login_via_dialog(email)`, revoke+confirm as above, then
  `login_via_dialog(email)` again with the **same** email. Because `unlink_email` nulled
  the old account's email, `attach_login` takes the "first login fresh" branch → new
  account. Assert the Liked view is empty.

  (Skip the warning-Cancel micro-interaction — it's pure client state, low value; the
  grant/deny popover screenshots already in `cookies-privacy.spec.ts` cover the dialog's
  appearance.)

## Things to watch

- **Action timeout is 1000ms** (`playwright.config.ts` `actionTimeout`). The code-readback
  poll must use `expect.poll`/explicit waits, not a single `getAttribute`, since the
  `request_login_code` server action round-trips before the row exists.
- **`verify_login_code` deletes the code on success** — read the code *before* clicking
  Verify. The wrong-code test relies on wrong attempts *not* deleting the row (confirmed in
  [auth.ts:62](src/lib/db/auth.ts#L62)).
- **Reload waits**: `onSuccess` and revoke-confirm both call `window.location.reload()` /
  `router.refresh()`. Wait on feed cards re-rendering before asserting menu/cookies.
- **Unique emails everywhere** (parallelism). Never hardcode a shared email.
- After type-check passes, run `npm run check-fix` (project rule). Follow snake_case /
  const-arrow / curly-brace conventions in the new helpers.

## Verification

1. `npm run test:e2e` — runs all specs (seeds the fixture DB automatically). New
   `auth.spec.ts` tests must pass in both `mobile-light` and `mobile-dark`.
2. If screenshots are included: first run `npm run test:e2e:update` to capture baselines,
   then re-run `npm run test:e2e` to confirm stability.
3. `npm run check` for type-check + lint on the new/edited helper + spec files.
4. Confirm no regression in existing [cookies-privacy.spec.ts](e2e/tests/cookies-privacy.spec.ts)
   after relocating `open_consent` into `pages.ts`.
