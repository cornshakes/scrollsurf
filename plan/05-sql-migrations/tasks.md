# SQLite migrations — tasks

Implementation order. Each task is self-contained; later tasks assume earlier ones
are merged. See [plan.md](plan.md) for the full rationale.

## Tasks

- [x] 1. [haiku] Create `src/lib/db/migrations.ts` — migration type + initial 3-migration history
- [x] 2. [sonnet] Create `src/lib/db/migrate.ts` — versioned runner with full transaction semantics
- [x] 3. [haiku] Slim `src/lib/db/connection.ts` — add `open_db`, delete `create_schema`
- [x] 4. [haiku] Update `scripts/create-e2e-db.ts` — replace `new DatabaseSync + create_schema` with `open_db`
- [x] 5. [sonnet] Create `tests/lib/db/migrate.test.ts` — runner + history tests

---

## 1. [haiku] Create `src/lib/db/migrations.ts`

New file. Export the `migration` type and the `migrations` array:

```ts
export type migration = {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
};

export const migrations: readonly migration[] = [...];
```

Three initial migrations, converting the existing hacks in `create_schema` into explicit entries:

1. **`baseline`** (version 1) — the full `CREATE TABLE IF NOT EXISTS` block from
   [`src/lib/db/connection.ts`](src/lib/db/connection.ts) lines 13–107 verbatim,
   including `caption` in `pictures`, but **without** the `DROP TABLE IF EXISTS user_settings`
   line and the `try/catch` `ALTER TABLE`. `IF NOT EXISTS` stays — it lets the existing prod
   DB (user_version 0, tables already present) no-op through without a separate detection path.

2. **`drop_user_settings`** (version 2) — `db.exec('DROP TABLE IF EXISTS user_settings')`.

3. **`add_pictures_caption`** (version 3) — conditional: query
   `pragma_table_info('pictures')` for a row with `name = 'caption'`; `ALTER TABLE` only
   if the column is missing. Needed because the baseline's `IF NOT EXISTS` lets a pre-caption
   prod DB skip the `pictures` DDL, so this migration is the only place that column gets added
   to those DBs.

Add a header comment stating the append-only rules: no editing shipped migrations, no
`BEGIN`/`COMMIT` inside `up` (the runner owns the transaction), no PRAGMAs that can't run
inside a transaction, prepare statements per call (no module-level caches).

## 2. [sonnet] Create `src/lib/db/migrate.ts`

New file. Export two functions:

```ts
export const get_user_version = (db: DatabaseSync): number;
export const migrate = (db: DatabaseSync, list: readonly migration[] = migrations): void;
```

Runner semantics, in order:

1. **Validate the list** — versions must be exactly `1..list.length` in array order.
   Throw naming the offending entry. This runs on every startup and in every test.
2. **Downgrade guard** — if `user_version > list.length`, throw:
   `"database is at schema version X but this code only knows up to Y"`.
3. Set `PRAGMA foreign_keys = OFF` before the migration loop; restore to `ON` in `finally`.
   (FK pragma is a no-op inside a transaction, so it must bracket the loop; needed for
   future 12-step table rebuilds.)
4. **Per pending migration — one transaction each:**
   - `BEGIN IMMEDIATE` (acquires the write lock up front so racing processes serialize)
   - Re-read `user_version` inside the transaction; skip if another process already applied it
   - Call `up(db)`
   - `PRAGMA user_version = N` (transactional — rolls back with the migration if it fails)
   - `COMMIT`
5. **On failure:** `ROLLBACK` (wrapped in its own try/catch), then rethrow as
   `new Error("migration N (name) failed", { cause })`. Guarantee: `user_version` equals
   the last fully committed migration; partial DDL is rolled back.

## 3. [haiku] Slim `src/lib/db/connection.ts`

Three changes, no behavior change for callers:

- Add `open_db(file: string): DatabaseSync` — opens the file, sets `PRAGMA journal_mode = WAL`,
  `PRAGMA busy_timeout = 5000`, `PRAGMA foreign_keys = ON`, then calls `migrate(target)` and
  returns the DB. Match the skeleton in [plan.md](plan.md) exactly.
- Update `init_db` to call `open_db(db_path())` instead of `new DatabaseSync` +
  `create_schema`. The reset-guard logic and `mkdir` stay unchanged.
- Delete `create_schema` entirely (and its import if it had one).

Do **not** re-export `open_db` or `migrate` from `src/lib/db/index.ts` — they are internal
to connection setup, the e2e script, and tests.

## 4. [haiku] Update `scripts/create-e2e-db.ts`

Replace lines 47–48 (approximately):

```ts
// before
const e2e_db = new DatabaseSync(e2e_db_path);
create_schema(e2e_db);

// after
const e2e_db = open_db(e2e_db_path);
```

Update the import on line 10 accordingly: drop `create_schema`, add `open_db` from
`../src/lib/db/connection`. The committed fixture will carry `user_version = 3` next time
`npm run test:e2e:create-db` is run; the old fixture (version 0) is migrated idempotently
at dev-server startup, so rebuilding is optional but recommended.

## 5. [sonnet] Create `tests/lib/db/migrate.test.ts`

Use `new DatabaseSync(':memory:')` with injected fake migration lists for runner tests.
Use the real `migrations` export for history tests. Do **not** use `reset_db` or temp-dir
machinery for the runner tests.

**Runner tests (fake lists):**

1. Applies in order — 3 fakes record their versions; assert order and final `user_version = 3`.
2. Mid-version DB applies only pending — stamp version 1; assert only 2 and 3 run.
3. Up-to-date DB is a no-op.
4. Failure rolls back — migration 2 creates a table then throws; assert error message names
   `migration 2` + name, `cause` is preserved, `user_version = 1`, half-created table absent
   from `sqlite_master`.
5. Downgrade fails loudly — stamp version 99; assert throw, nothing ran.
6. List validation — gaps (`[1,3]`), wrong start (`[2,3]`), duplicates (`[1,1,2]`) each throw
   before any `up` runs.
7. `foreign_keys` reads `1` after both a successful and a failing run.

**Real-history tests (real `migrations` list):**

8. Fresh DB reaches final schema — `user_version = 3`; spot-check `sqlite_master` for key
   tables and indexes; `pictures.caption` column exists; `user_settings` table absent.
9. Legacy prod DB converges — build the as-it-was schema inline: all baseline tables including
   `user_clicks` + `idx_user_clicks_user`, `pictures` **without** `caption`, plus a
   `user_settings` table; seed one picture row; run `migrate`; assert `caption` added with
   `''` for the existing row, `user_settings` gone, seeded row survived, `user_version = 3`.
10. Idempotent re-run — call `migrate` twice on a fresh DB; assert second call changes nothing
    and does not throw.
