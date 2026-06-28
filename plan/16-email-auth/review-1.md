approve

## Check results

- `npm run check` (tsc + eslint): **PASS** — clean
- `npm test`: 121/122 pass. The one failure is in `tests/lib/db/feed.test.ts` ("likes do not influence how many quotes are drawn"), a pre-existing probabilistic test that draws 105 where the tolerance cap is 104 — unrelated to this PR. All 20+ new auth tests pass.

---

## Migrations (v11–v13)

**v11** — correct. `ALTER TABLE users ADD COLUMN email TEXT` + partial unique index.

**v12** — the tricky one. The code correctly handles the SQLite 3.26+ FK-rename behaviour: renaming the old `users` to `_old` would cause SQLite to silently rewrite `tokens`'s FK from `users(id)` to `_old(id)`. The chosen approach — create `tokens`, copy data, build `_users_new`, **DROP** old `users`, rename `_users_new` to `users` — avoids that trap and is well-commented. The runner holds `foreign_keys = OFF`, so the DROP with dependent rows is safe. ✓

**v13** — trivial. ✓

---

## `src/lib/db/auth.ts`

`attach_login` is the most critical function. All six branches from the plan are implemented and tested:

| Branch | Implemented | Tested |
|---|---|---|
| Already this account | ✓ | ✓ |
| Merge anon → account | ✓ | ✓ |
| Switch accounts | ✓ | ✓ |
| No current token | ✓ | ✓ |
| First login – promote | ✓ | ✓ |
| First login – fresh | ✓ | ✓ |

`merge_anon_to_account` correctly satisfies all FK constraints before deleting the anon user row: moves `user_items`, `user_clicks`, and `tokens` (in that order), deletes remaining `user_items`, then deletes `users`. ✓

Manual `BEGIN IMMEDIATE / COMMIT / ROLLBACK` pattern in `attach_login` is appropriate here; `node:sqlite`'s synchronous API means there are no async interleaving hazards.

`generate_code()` uses `buf[0] % 1_000_000`. There is a trivial modulo bias (~0.002%) since 2³² is not divisible by 10⁶ — completely acceptable for a login code.

---

## `src/lib/db/users.ts`

`cleanup_inactive_users` now `DELETE FROM tokens WHERE last_active_at < cutoff` (no longer nulls `cookie_token`). History rows (`user_items`, `user_clicks`, `users`) survive, which is the intended behaviour. The once-per-hour throttle lives in `get_or_create_user` (same pattern as before). ✓

---

## `src/lib/email.ts`

Lazily builds the transporter; falls back to `console.warn` when `SMTP_HOST` is unset. Plan said `console.log` — `console.warn` is marginally more visible in the server console, a fine call. No persistent transporter (created per-call) is appropriate for low-traffic; no objection.

Minor: no distinction between port 587 (STARTTLS) and 465 (SSL) in the transporter config. For the Raspberry Pi deployment this is unlikely to matter, but worth noting if a self-hosted SMTP with SSL is ever used.

---

## `src/app/actions.ts`

- `request_login_code`: rate-limit error propagated; all other errors collapse to a generic message; always returns `{ ok: true }` on success to avoid email enumeration. ✓
- `submit_login_code`: reads `ss_uid`, passes it to `attach_login`, sets both cookies (login implies consent). ✓
- `logout`: mints fresh anonymous token, does not touch consent cookie. ✓
- `get_current_account`: clean. ✓
- `revoke_consent` update: calls `unlink_email` before clearing `ss_uid`. Email-null users can no longer recover history by re-login (as intended). ✓

---

## `src/components/Account.tsx`

Two-step `Dialog` (email → 6-digit code) with inline error display, loading state, and a Back button. State resets on close via `handle_close`. `slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}` is the correct MUI v9 API. `useCallback` with empty deps for stable references. ✓

One stylistic note: the `logout` key in `AuthContextValue` shadows the imported `logout` action name inside `AuthProvider`. The rename to `handle_logout` correctly avoids the collision. ✓

---

## `src/components/CookieConsent.tsx`

`handle_revoke_click` → if account present, show warning; else proceed. `handle_revoke_confirmed` calls `revoke_consent()`, then `refreshAccount()`, then `window.location.reload()`. The `refreshAccount()` is technically redundant (reload reinitialises everything) but harmless. ✓

---

## `src/components/WikiArticles.tsx` / `App.tsx`

Provider order `AuthProvider → ConsentProvider → FeedProvider` matches the plan (ConsentProvider can read `useAuth()`). Drawer login/logout entries are clean. ✓

---

## Tests

`tests/auth.test.ts` is thorough:
- Full coverage of `create_login_code`/`verify_login_code` (valid, wrong, expired, upsert, normalisation, unknown email, rate-limit allow/deny).
- Migration v12 upgrade path tested on an in-memory DB seeded at v11.
- `get_or_create_user` against the new `tokens` table.
- One test per `attach_login` branch with precise DB-state assertions.
- `unlink_email` and `get_user_email` edge cases.

`tests/lib/db/users.test.ts` is updated to use the new `tokens` table in `cleanup_inactive_users` assertions. ✓

`tests/helpers/test-db.ts`'s `insert_user` helper is updated (inserts into `users` + `tokens` separately; `cookie_token` column is gone). ✓

---

## Summary

All tasks complete. Code is correct, well-tested, follows project conventions (snake_case, `sx`-only styling, no ORM, no module-level statement caches, append-only migrations). The one failing test is a pre-existing probabilistic flake in the feed module — not introduced by this PR.
