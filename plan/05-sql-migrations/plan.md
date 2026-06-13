# SQLite Migrations via `PRAGMA user_version`

## Context

All schema DDL for `scrollsurf.db` currently lives in `create_schema()` in `src/lib/db/connection.ts`: a `CREATE TABLE IF NOT EXISTS` block plus two accreting hacks — an inline `DROP TABLE IF EXISTS user_settings` and a blind `try/catch` around `ALTER TABLE pictures ADD COLUMN caption`. Every schema change adds another forever-hack, and `IF NOT EXISTS` silently ignores drift. The goal is a proper versioned migration system using SQLite's built-in `PRAGMA user_version` slot.

**Approach — no external migration library.** Popular libraries (`umzug`, `db-migrate`) require wrapping the DB connection with their own interface; none natively support `node:sqlite`'s `DatabaseSync`. SQLite's `user_version` is a single integer tracking the applied migration count — exactly what the runner below needs. The 50-line hand-written runner is the right tool, not wheel reinvention.

Scope is migrations only — no schema changes, no unrelated refactors. Migrations apply only to the runtime `scrollsurf.db`; reference DBs in `datasets/` are regenerated build artifacts and stay out of scope.

Verified facts: all DDL is centralized in `create_schema`; its only callers are `init_db()` (startup via `instrumentation.ts` and the unit-test `reset_db()` helper) and `scripts/create-e2e-db.ts` (builds the committed Playwright fixture). `instrumentation.ts` imports five article datasets and two picture datasets (`featured_pictures.db`, `commons_featured_pictures.db`) — none of this is affected by migrations. The prod DB (Pi, `SCROLLSURF_DATA_DIR=/data`) has all tables — including `user_clicks` and `idx_user_clicks_user`, which were added before migrations existed — but `user_version = 0`.

## End state

### File layout

```
src/lib/db/migrations.ts       (new)     — migration type + ordered list
src/lib/db/migrate.ts          (new)     — runner
src/lib/db/connection.ts       (slimmed) — open + pragmas + migrate; create_schema deleted
scripts/create-e2e-db.ts       (small)   — open_db() instead of new DatabaseSync + create_schema
tests/lib/db/migrate.test.ts   (new)     — runner + history tests
```

Untouched: `src/instrumentation.ts`, `src/lib/db/index.ts`, `src/lib/import-datasets.ts` (its direct `db` import keeps working — `init_db` still assigns the mutable export), `tests/helpers/test-db.ts` (`init_db(true)` now opens + migrates), `e2e/fixtures/reset-e2e-db.ts`.

### `src/lib/db/migrations.ts`

```ts
export type migration = {
  version: number; // contiguous, starting at 1
  name: string;
  up: (db: DatabaseSync) => void;
};

export const migrations: readonly migration[] = [...];
```

`up` is a function (not a SQL string) so future migrations can do data transforms in TS. Up-only — no `down` (single-server deployment; recovery = restore the DB file). A header comment states the rules: append-only, never edit a shipped migration; no BEGIN/COMMIT inside `up` (runner owns the transaction); no PRAGMAs that can't run in a transaction; prepare statements per call (no module-level caches).

Initial history (converts the existing hacks into explicit, testable migrations):

1. **`baseline`** — the current `CREATE TABLE IF NOT EXISTS` block from `connection.ts:13-107` verbatim, including `caption` in `pictures`, minus the `user_settings` DROP and the try/catch ALTER. `IF NOT EXISTS` stays in the baseline only — it's what lets the existing prod DB (version 0, tables present) no-op through. No stamping/detection heuristic; every DB takes the identical code path.
2. **`drop_user_settings`** — `DROP TABLE IF EXISTS user_settings`.
3. **`add_pictures_caption`** — conditional: check `pragma_table_info('pictures')` for `caption`, ALTER only if missing. Needed because a pre-caption prod DB no-ops through the baseline (its `pictures` table already exists) and would otherwise never gain the column. Post-hack DBs and fresh DBs already have it and skip the ALTER.

From version 4 onward, migrations are unconditional — `user_version` exactly determines the prior state.

### `src/lib/db/migrate.ts`

```ts
export const get_user_version = (db: DatabaseSync): number;
export const migrate = (db: DatabaseSync, list: readonly migration[] = migrations): void;
```

Runner semantics, in order:

1. **Validate the list** on every run: versions must be exactly `1..list.length` in array order. Throw naming the offending entry. (Runs on every startup and in every test — no separate dev-time assertion needed.)
2. **Downgrade guard**: if `user_version > latest known`, throw loudly ("database is at schema version X but this code only knows up to Y").
3. `PRAGMA foreign_keys = OFF` before the loop, restored to `ON` in `finally`. (FK pragma is a no-op inside a transaction, so it must bracket the loop; required for future 12-step table rebuilds.)
4. Per pending migration, **one transaction each**: `BEGIN IMMEDIATE` (write lock up front so racing processes serialize); re-read `user_version` inside the transaction and skip if another process already applied it; run `up(db)`; `PRAGMA user_version = N` (transactional — rolls back with the rest); `COMMIT`.
5. On failure: `ROLLBACK` (wrapped in its own try/catch), rethrow as `Error("migration N (name) failed", { cause })`. Guarantee: `user_version` equals the last fully-committed migration; partial work is rolled back (SQLite DDL is transactional).

Connection-level PRAGMAs (`journal_mode = WAL`, `busy_timeout`) stay in connection setup, never in migrations — WAL can't be set inside a transaction and isn't schema history.

### `src/lib/db/connection.ts` (slimmed)

```ts
export let db: DatabaseSync;

export const open_db = (file: string): DatabaseSync => {
  const target = new DatabaseSync(file);
  target.exec('PRAGMA journal_mode = WAL');
  target.exec('PRAGMA busy_timeout = 5000');
  target.exec('PRAGMA foreign_keys = ON');
  migrate(target);
  return target;
};

export const init_db = (reset = false) => { /* unchanged guard + mkdir, then db = open_db(db_path()) */ };
export const get_db = (): DatabaseSync => { init_db(); return db; };
```

`create_schema` is deleted. `migrate` is not re-exported from `src/lib/db/index.ts` — internal to connection, the e2e script (via `open_db`), and tests (direct import).

### `scripts/create-e2e-db.ts`

Replace the `create_schema` import (line 10) and `new DatabaseSync(e2e_db_path); create_schema(e2e_db)` (lines 47–48) with `const e2e_db = open_db(e2e_db_path)`. The committed fixture then carries `user_version = 3`. Rebuilding the fixture (`npm run test:e2e:create-db`) is optional — the dev server migrates the copied old fixture idempotently at startup anyway — but recommended so the committed file is current.

### Prod rollout (Pi, version 0)

First startup: baseline no-ops via `IF NOT EXISTS`, `user_settings` dropped if still present, `caption` check sees the column exists and skips, `user_version` lands at 3. Same path as a fresh dev DB.

## Tests — `tests/lib/db/migrate.test.ts`

Runner tests use `new DatabaseSync(':memory:')` with small injected fake migration lists (no `reset_db`/temp-dir machinery); history tests use the real `migrations` export.

Runner semantics (fake lists):
1. Applies in order — 3 fakes record their versions; assert order and final `user_version = 3`.
2. Mid-version DB applies only pending — stamp version 1; assert only 2 and 3 run.
3. Up-to-date DB is a no-op.
4. Failure rolls back — migration 2 creates a table then throws; assert error message names `migration 2` + name, `cause` preserved, `user_version = 1`, half-created table absent from `sqlite_master`.
5. Downgrade fails loudly — stamp version 99; assert throw, nothing ran.
6. List validation — gaps (`[1,3]`), wrong start (`[2,3]`), duplicates (`[1,1,2]`) each throw before any `up` runs.
7. `foreign_keys` reads 1 after both a successful and a failing run.

Real history:
8. Fresh DB reaches final schema — `user_version = 3`; spot-check `sqlite_master` for key tables/indexes; `pictures.caption` exists; `user_settings` absent.
9. Legacy prod DB converges (key regression test) — build the as-it-was schema inline: all baseline tables including `user_clicks` + `idx_user_clicks_user` (they were in prod at `user_version = 0`), `pictures` without the `caption` column, plus a `user_settings` table; seed one picture row; migrate; assert `caption` added with `''` for the existing row, `user_settings` gone, seeded row survived, version 3.
10. Idempotent re-run — `migrate` twice changes nothing and doesn't throw.

Existing suites (`tests/lib/db/*.test.ts`, `tests/actions.test.ts`) double as integration coverage: `reset_db()` → `init_db(true)` → `open_db` → `migrate` must produce a schema all current queries work against.

## Verification

1. `npm run check` (tsc + eslint), then `npm run lint-fix`.
2. `npm test` — new migrate suite + all existing suites green.
3. Legacy-upgrade smoke beyond the unit test: the e2e flow exercises it — `npm run test:e2e` copies the old committed fixture (version 0), the dev server startup migrates it, Playwright tests pass.
4. Optionally rebuild + commit the e2e fixture (`npm run test:e2e:create-db`) and re-run `npm run test:e2e`.
5. Manual: `npm run dev` against the existing local `scrollsurf.db`; confirm startup logs clean and `PRAGMA user_version` reports 3 (`sqlite3 scrollsurf.db 'PRAGMA user_version'`).
