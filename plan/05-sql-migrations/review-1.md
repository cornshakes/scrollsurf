# Review 1 — SQLite migrations via `PRAGMA user_version`

Reviewer: Claude (Opus 4.8). Scope: implementation of [plan.md](plan.md) /
[tasks.md](tasks.md). No prior review files existed. **Review only — no edits made.**

## Verdict

**Approve.** The implementation matches the plan faithfully, all checks are green, and
the migration semantics are correct. Findings below are minor/observational; none block.

## What I verified

### Build & tests
- `npm run check` (tsc + eslint) — clean, no output.
- `npx jest tests/lib/db/migrate.test.ts` — **10/10 passing**.
- `npx jest` (full suite) — **85/85 passing across 9 suites**. The existing db/action
  suites exercise `init_db(true) → open_db → migrate`, so the runner is integration-tested
  against every current query, not just the dedicated tests.

### Faithfulness to plan
- `migrations.ts`: baseline (v1) is a **verbatim** copy of the old `create_schema` DDL
  (diffed against `HEAD:src/lib/db/connection.ts`), correctly minus the inline
  `DROP TABLE IF EXISTS user_settings` and the `try/catch ALTER ... caption`. `IF NOT EXISTS`
  retained in baseline only. v2 = `drop_user_settings`, v3 = conditional `add_pictures_caption`
  via `pragma_table_info`. Header comment states the append-only rules. ✔
- `migrate.ts`: list validation (1..length, in order), downgrade guard (`current > list.length`),
  `foreign_keys = OFF` bracketing the loop with `ON` restored in `finally`, one
  `BEGIN IMMEDIATE` transaction per migration, in-transaction re-read for racing processes,
  transactional `PRAGMA user_version = N`, `ROLLBACK` wrapped in its own try/catch, and rethrow
  as `Error("migration N (name) failed", { cause })`. All as specified. ✔
- `connection.ts`: `open_db` matches the plan skeleton exactly; `init_db` keeps the
  reset-guard + `mkdir`; `create_schema` deleted. ✔
- `index.ts` does **not** re-export `open_db`/`migrate` (only `db, init_db`) — as required. ✔
- `create-e2e-db.ts`: import swapped to `open_db`, `new DatabaseSync + create_schema`
  replaced by `const e2e_db = open_db(e2e_db_path)`. ✔
- `grep` for `create_schema` across `src/scripts/tests/e2e` returns **zero** stale references. ✔
- Tests cover all 10 cases enumerated in the plan (7 runner + 3 real-history), including the
  key legacy-prod-convergence regression (pictures without `caption`, leftover `user_settings`,
  seeded row survives with `caption = ''`, lands at version 3). ✔

## Findings

### 1. (Low / observational) `BEGIN IMMEDIATE` failure is not wrapped
`db.exec('BEGIN IMMEDIATE')` (migrate.ts:46) sits *outside* the inner `try`. Under genuine
write-lock contention exceeding `busy_timeout` (5s), it would throw a raw `SQLITE_BUSY` rather
than the friendly `"migration N (name) failed"`. This is arguably **correct** — no migration
actually started, so there is nothing to roll back, and the outer `finally` still restores
`foreign_keys = ON`. Noting only so it is a conscious choice, not an oversight. No change needed.

### 2. (Info) E2e fixture left at `user_version = 0`; e2e suite not run
The committed `e2e/fixtures/scrollsurf-e2e-test.db` is still at `user_version = 0` (confirmed via
`sqlite3`). This is **intended** per the plan — rebuilding is optional because the dev server
migrates the copied fixture idempotently at startup. The unit-level legacy-convergence test
exercises the same upgrade path. I did **not** run `npm run test:e2e` (Playwright + dev server +
datasets); plan verification steps 3–4 remain unexecuted and are worth running before merge if a
clean e2e pass is desired. Optionally rebuild the fixture (`npm run test:e2e:create-db`) so the
committed file carries version 3.

### 3. (Trivia) Stray WAL sidecar files
`e2e/fixtures/scrollsurf-e2e-test.db-shm` and `-wal` show as untracked. These are WAL-mode
byproducts (the fixture's header persists `journal_mode = WAL`; any open — including a plain read —
spawns them) and were likely created during this review. Confirm they are gitignored so they are
never committed. Not caused by the migration change itself.

## Notes on quality
- Per-call statement preparation throughout; no module-level statement caches
  (consistent with [[prefer-fixing-prod-code-over-test-workarounds]]).
- No backfill/repair machinery added to the data pipeline; the conditional `caption` ALTER is a
  one-time schema migration on the runtime DB, not dataset repair
  (consistent with [[datasets-are-download-once-no-backfill]]).
- Style conventions honored: snake_case, const arrow functions, curly braces on all blocks.
- Migration `up` is a TS function (not a SQL string), preserving the plan's room for future
  data-transform migrations.

## Recommendation
Merge-ready. Before merge, optionally run `npm run test:e2e` to close plan verification steps 3–4,
and confirm the `*.db-shm`/`*.db-wal` sidecars are gitignored.
