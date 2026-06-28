# Tasks: E2E tests for login dialog, account switch & revoke consent

## TOC

- [x] Add DB helpers (`read_login_code`, `get_email_for_token`, `seed_account`) [haiku]
- [x] Move `open_consent` to `pages.ts` and add `login_via_dialog` [sonnet]
- [x] `auth.spec.ts` — Login dialog describe block [sonnet]
- [x] `auth.spec.ts` — Logout describe block [haiku]
- [x] `auth.spec.ts` — Account switch describe block [sonnet]
- [x] `auth.spec.ts` — Revoke consent describe block [sonnet]

---

## 1. Add DB helpers (`read_login_code`, `get_email_for_token`, `seed_account`) [haiku]

**File:** `e2e/helpers/db.ts` (extend existing)

Add three helpers following the same `DatabaseSync` patterns already in the file:

**`read_login_code(email: string): string | null`**
- Open a read-only connection to `e2e/.data/scrollsurf.db`
- `SELECT code FROM login_codes WHERE email = ?` with `email.toLowerCase()` to match `create_login_code`
- Return `null` if no row found

**`get_email_for_token(token: string): string | null`**
- Open a read-only connection
- JOIN `tokens` → `users` on `tokens.user_id = users.id`
- `WHERE tokens.token = ?`, return `users.email`
- Return `null` if not found

**`seed_account(email: string, liked_url: string): void`**
- Open a **read/write** connection (WAL mode lets the dev server see the write immediately)
- Insert a `users` row with the given email
- Look up `items.id WHERE url = liked_url`
- Insert a `user_items` row `(user_id, item_id, vote=1)` for the new user
- No token needed — `attach_login` finds the account by email at login time

---

## 2. Move `open_consent` to `pages.ts` and add `login_via_dialog` [sonnet]

**Files:** `e2e/helpers/pages.ts` (extend), `e2e/tests/cookies-privacy.spec.ts` (update import)

**Move `open_consent`:**
- `open_consent` is currently defined and exported inside `cookies-privacy.spec.ts`
- Cut it from there, paste into `pages.ts` as an exported const arrow function
- Update `cookies-privacy.spec.ts` to import it from `../helpers/pages`

**Add `login_via_dialog(page, email)`:**
- `open_menu(page)` → click the `Log in` list item
- Fill the `Email` text field with the email
- Click `Send code`
- `expect.poll(() => read_login_code(email))` until a non-null value is returned (handles the server-action round-trip; action timeout is 1000ms so polling is required)
- Read the code **before** clicking Verify (the code is deleted on success)
- Fill the `6-digit code` field with the retrieved code
- Click `Verify`
- Wait for `page.getByTestId('feed-card').first()` to be visible (the `onSuccess` triggers `window.location.reload()`)

---

## 3. `auth.spec.ts` — Login dialog describe block [sonnet]

**File:** `e2e/tests/auth.spec.ts` (create)

All tests: `load_page(page, true)` (consented anonymous) + `const email = \`${randomUUID()}@example.com\``

**`logs in via email code and shows the account in the menu`**
- `scroll_to_load_all`, `find_card_by_text(page, 'Yoga')`, like it via `vote_card`
- `login_via_dialog(page, email)`
- `open_menu` → assert the email text and a "Log out" item are visible
- `switch_view` to Liked → assert "Yoga" is still present (promote-anon keeps history)

**`rejects an invalid email`**
- Open the login dialog → type `not-an-email` → click `Send code`
- Assert the `Invalid email` Alert is visible
- Assert the dialog is still on the email step (no code field visible)

**`rejects a wrong code, then accepts the correct one`**
- Open dialog, real email, `Send code`
- Read the real code via `read_login_code(email)`
- Enter a 6-digit value guaranteed ≠ the real code → click `Verify`
- Assert `Invalid or expired code` Alert is visible
- Fill the real code → click `Verify`
- Assert logged in via `open_menu` showing the email

**`renders the email and code steps` (screenshots)**
- Open the login dialog → `toHaveScreenshot('login-dialog-email.png')` targeting `page.getByRole('dialog')`; use `maxDiffPixels` tolerance matching the existing consent-popover snapshots in `cookies-privacy.spec.ts`
- Enter email → click `Send code` → `toHaveScreenshot('login-dialog-code.png')` with `mask: [page.getByText(/sent a 6-digit code/)]` to hide the unique email from the baseline

---

## 4. `auth.spec.ts` — Logout describe block [haiku]

**File:** `e2e/tests/auth.spec.ts` (append to existing)

**`logs out and returns to the anonymous menu`**
- `login_via_dialog(page, email)`
- `open_menu` → confirm email is shown
- Click "Log out" → wait for `page.getByTestId('feed-card').first()` to be visible (reload)
- `open_menu` → assert the `Log in` list item is back and email text is gone

---

## 5. `auth.spec.ts` — Account switch describe block [sonnet]

**File:** `e2e/tests/auth.spec.ts` (append to existing)

**`switching accounts swaps the visible history`**
- `seed_account(emailB, YOGA_URL)` — account B has a liked "Yoga" article (define `YOGA_URL` as a constant at the top of the spec, matching the seeded item's URL)
- `login_via_dialog(page, emailA)` → promotes the anonymous session to account A
- Like a different seeded article (e.g. "Write amplification") via `vote_card`
- `login_via_dialog(page, emailB)` → token repoints to B (switch, no merge)
- `switch_view` to Liked → assert "Yoga" is visible and "Write amplification" is **not**
- `open_menu` → assert `emailB` is shown

---

## 6. `auth.spec.ts` — Revoke consent describe block [sonnet]

**File:** `e2e/tests/auth.spec.ts` (append to existing)

**`withdrawing consent removes the account and clears cookies`**
- `login_via_dialog(page, email)`
- `open_consent(page)` → click `Withdraw consent`
- Assert the warning Alert ("This removes your account…") and `Confirm`/`Cancel` buttons are visible
- Click `Confirm` → wait for reload (`page.getByTestId('feed-card').first()` visible)
- Read cookies via `page.context().cookies()` → assert `ss_consent === 'denied'` and `ss_uid` is absent
- `open_menu` → assert `Log in` is shown (account gone)

**`re-login after revoke creates a fresh account with no history`**
- Like a seeded article, `login_via_dialog(page, email)`
- `open_consent(page)` → `Withdraw consent` → `Confirm` → wait for reload
- `login_via_dialog(page, email)` with the **same** email
- Because `unlink_email` nulled the old account's email, `attach_login` takes the "first login fresh" branch → brand new account
- `switch_view` to Liked → assert the view is empty
