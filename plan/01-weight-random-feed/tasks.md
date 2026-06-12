# Topic-Affinity Weighted Feed — Tasks

## TOC

- [x] 1. Create `src/lib/db/affinity.ts` [sonnet]
- [x] 2. Update `src/lib/db/articles.ts` — wire affinity into get_next [haiku]
- [x] 3. Update `src/lib/db/pictures.ts` — wire affinity into get_next [haiku]
- [x] 4. Update CLAUDE.md feed selection section [haiku]
- [x] 5. Add `FEED_AFFINITY_STRENGTH` to CLAUDE.md feature-flags table [haiku]
- [x] 6. Add `FEED_AFFINITY_STRENGTH` comment to `.env.example`, `.env.prod`, `.env.test` [haiku]
- [x] 7. Write `tests/lib/db/affinity.test.ts` [sonnet]
- [x] 8. Run type-check (`npx tsc --noEmit`) [haiku]
- [x] 9. Run `npm run lint-fix` [haiku]
- [x] 10. Run `npm test` [haiku]
- [x] 11. Run E2E suite [haiku]

**Review 1**
- [x] 12. Fix stale "ORDER BY RANDOM()" sentence in CLAUDE.md [haiku]
- [x] 13. Fix `FEED_AFFINITY_STRENGTH` NaN guard in `affinity.ts` [haiku]
- [x] 14. Log WAL checkpoint errors instead of swallowing them silently [haiku]

**Review 2**
- [x] 15. Fix `reset_db` to also delete `-wal` and `-shm` sidecar files [haiku]
- [x] 16. Add `AFFINITY_STRENGTH=0` test case to `affinity.test.ts` [sonnet]
- [x] 17. Prepare statements per call instead of caching at init (unblocks 15/16)

---

## 1. Create `src/lib/db/affinity.ts` [sonnet]

New file. Contains shared constants, the `AffinityTables` type, and two exported SQL fragments used by both articles and pictures queries.

**Constants:**
```ts
export const W_LIKE = 1.0;
export const W_CLICK = 0.5;
export const W_DISLIKE = 1.0;
export const AFFINITY_SMOOTHING = 5.0;
export const AFFINITY_CLAMP = 2.0;
export const AFFINITY_STRENGTH =
  process.env.FEED_AFFINITY_STRENGTH !== undefined
    ? parseFloat(process.env.FEED_AFFINITY_STRENGTH)
    : 2.0;
```

**`affinity_ctes(t: AffinityTables): string`** — returns a `WITH …` SQL prefix. The CTE chain:
1. `clicked` — DISTINCT item_ids from `user_clicks` for this user + item_type
2. `topic_affinity MATERIALIZED` — per `(dataset, topic)`: `(likes + 0.5·clicked − dislikes) / (seen + SMOOTHING)`; uses `u.like` (never bare `like`)
3. `item_affinity MATERIALIZED` — per item_id: `AVG(COALESCE(ta.affinity, 0.0))` joined from topics

**`WEIGHTED_RANDOM_ORDER_BY`** — exported string constant:
```sql
ORDER BY -ln(max((RANDOM() / 9223372036854775808.0 + 1.0) / 2.0, 1e-12))
         / exp(AFFINITY_STRENGTH * max(-AFFINITY_CLAMP, min(AFFINITY_CLAMP, COALESCE(ia.affinity, 0.0))))
```

`AffinityTables` type:
```ts
type AffinityTables = {
  topics_table: 'article_topics' | 'picture_topics';
  user_table: 'user_articles' | 'user_pictures';
  item_id_col: 'article_id' | 'picture_id';
  item_type: 'article' | 'picture';
};
```

---

## 2. Update `src/lib/db/articles.ts` — wire affinity into get_next [haiku]

Three changes to the `get_next` prepared statement string (no other changes):

1. **Prefix** the SQL with `affinity_ctes({ topics_table: 'article_topics', user_table: 'user_articles', item_id_col: 'article_id', item_type: 'article' })`
2. **Add** `LEFT JOIN item_affinity ia ON ia.item_id = a.id` after the existing `LEFT JOIN user_articles` line
3. **Replace** `ORDER BY RANDOM()` with `WEIGHTED_RANDOM_ORDER_BY`

Import `affinity_ctes` and `WEIGHTED_RANDOM_ORDER_BY` from `./affinity`.

No changes to SELECT list, WHERE clause, LIMIT, `mark_seen`, `set_like`, `get_voted`, or any other statements.

---

## 3. Update `src/lib/db/pictures.ts` — wire affinity into get_next [haiku]

Identical pattern to task 2, using picture tables:

1. **Prefix** with `affinity_ctes({ topics_table: 'picture_topics', user_table: 'user_pictures', item_id_col: 'picture_id', item_type: 'picture' })`
2. **Add** `LEFT JOIN item_affinity ia ON ia.item_id = p.id`
3. **Replace** `ORDER BY RANDOM()` with `WEIGHTED_RANDOM_ORDER_BY`

No changes to any other statement or to `feed.ts`.

---

## 4. Update CLAUDE.md feed selection section [haiku]

Replace the current "Feed selection" section (the one that says `get_next_articles` and `get_next_pictures` use `ORDER BY RANDOM()`) with:

> `get_next_articles` and `get_next_pictures` use Efraimidis–Spirakis weighted sampling (`ORDER BY -ln(random)/weight`) where weight = `exp(AFFINITY_STRENGTH · mean_topic_affinity)`. Topic affinity is derived from the user's likes, dislikes, and link clicks on seen items, normalized by exposure (smoothing constant 5). Neutral users, anonymous users, and `FEED_AFFINITY_STRENGTH=0` all reduce to exactly uniform random — strict generalization of the previous behavior. Dislikes downweight topics but never hard-exclude items. Constants live in `src/lib/db/affinity.ts`. Do not add hard exclusions or deterministic secondary sorts.

---

## 5. Add `FEED_AFFINITY_STRENGTH` to CLAUDE.md feature-flags table [haiku]

Add one row to the Feature flags table:

| `FEED_AFFINITY_STRENGTH=N` | `2.0` | Strength of topic-affinity feed weighting; `0` = pure random |

---

## 6. Add `FEED_AFFINITY_STRENGTH` comment to env files [haiku]

In `.env.example`, `.env.prod`, and `.env.test`, add after the `FEED_PICTURE_RATIO` comment line:

```
# Optional: strength of topic-affinity feed weighting (default 2.0); 0 = pure random
# FEED_AFFINITY_STRENGTH=2.0
```

---

## 7. Write `tests/lib/db/affinity.test.ts` [sonnet]

New test file. Use existing helpers from `tests/helpers/test-db.ts` (`setup`, `reset_db`, `insert_user`, `insert_article`, `insert_picture`, `set_like`) and `record_click` from `@/lib/db/votes`. Call `beforeAll(() => setup())` and `beforeEach(() => reset_db())`.

`set_like` both marks seen and records the signal — the production lifecycle. Import `get_next_articles_internal` from `@/lib/db/articles` and `get_next_pictures_internal` from `@/lib/db/pictures`.

**Test cases:**

1. **Liked topic over-represented** (statistical): Insert 200 topic-X + 200 topic-Y articles (both same dataset). Like 20 extra X articles via `set_like`. Fetch 100. Assert X-count > 65. Comment: statistical; measured mean ≈ 82 ± 5; margin chosen to be non-flaky.

2. **Disliked topic under-represented, never excluded**: Dislike 20 Y articles. Fetch 100; assert Y-count < 35. Deterministic sub-check: single article in a heavily-disliked topic is still returned when `limit >= pool size`.

3. **Clicks alone boost**: Insert 200 topic-X + 200 topic-Y. Mark 20 X articles seen (`set_like(..., 0)`) then call `record_click('article', id, 'title', null, user_id)` on each. Fetch 100; assert X-count > 55.

4. **Neutral user**: Zero signals. Fetch `limit = pool size`. Assert all items returned (no items dropped or duplicated).

5. **Anonymous unchanged**: Another user has likes. Call `get_next_articles_internal(limit, null)`. Assert all unseen items returned; nothing marked seen.

6. **Cross-user isolation** (statistical): User A likes 20 X articles. User B (no signals) fetches 100 of 200X/200Y pool. Assert X-count between 35 and 65.

7. **Pictures mirror**: One statistical test via `get_next_pictures_internal` — like 20 picture-X items, assert X-count > 65 out of 100 fetched from 200X/200Y pool.

---

## 8. Run type-check [haiku]

```
npx tsc --noEmit
```

Fix any type errors before proceeding.

---

## 9. Run `npm run lint-fix` [haiku]

```
npm run lint-fix
```

Per CLAUDE.md: always run after type-check passes.

---

## 10. Run `npm test` [haiku]

```
npm test
```

Run the full test suite including the new `affinity.test.ts`. Re-run statistical tests 2–3 times to confirm margins are non-flaky. All existing test files must pass unchanged.

---

## 11. Run E2E suite [haiku]

```
npm run test:e2e
```

E2E suite should pass untouched — no API surface changed. If it fails, investigate; do not skip.

---

## Review 1 tasks

- [x] 12. Fix stale "ORDER BY RANDOM()" sentence in CLAUDE.md [haiku]
- [x] 13. Fix `FEED_AFFINITY_STRENGTH` NaN guard in `affinity.ts` [haiku]
- [x] 14. Log WAL checkpoint errors instead of swallowing them silently [haiku]

---

## 12. Fix stale "ORDER BY RANDOM()" sentence in CLAUDE.md [haiku]

In [CLAUDE.md](../../CLAUDE.md), find the sentence inside the "Pictures vs articles" section that reads:

> Each type has its own `ORDER BY RANDOM()` query; there is no SQL UNION.

Replace it with:

> Each type has its own weighted-random query; there is no SQL UNION.

---

## 13. Fix `FEED_AFFINITY_STRENGTH` NaN guard in `affinity.ts` [haiku]

[src/lib/db/affinity.ts:7-10](../../src/lib/db/affinity.ts#L7-L10) — `parseFloat("off")` silently produces `NaN`, which bakes into every ORDER BY expression and corrupts the draw.

Replace:

```ts
export const AFFINITY_STRENGTH =
  process.env.FEED_AFFINITY_STRENGTH !== undefined
    ? parseFloat(process.env.FEED_AFFINITY_STRENGTH)
    : 2.0;
```

With:

```ts
const _parsed_strength = parseFloat(process.env.FEED_AFFINITY_STRENGTH ?? '');
export const AFFINITY_STRENGTH = isNaN(_parsed_strength) ? 2.0 : _parsed_strength;
```

Matches the resilience pattern used for `FEED_PICTURE_RATIO`.

---

## 14. Log WAL checkpoint errors instead of swallowing them silently [haiku]

[tests/lib/db/affinity.test.ts:18-22](../../tests/lib/db/affinity.test.ts#L18-L22) — the empty `catch {}` hides real DB errors (e.g. unreleased locks) and makes root-cause diagnosis harder.

Replace:

```ts
afterEach(() => {
  try {
    get_db().exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {}
});
```

With:

```ts
afterEach(() => {
  try {
    get_db().exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.warn('WAL checkpoint failed:', e);
  }
});
```

---

## Review 2 tasks

- [x] 15. Fix `reset_db` to also delete `-wal` and `-shm` sidecar files [haiku]
- [x] 16. Add `AFFINITY_STRENGTH=0` test case to `affinity.test.ts` [sonnet]
- [x] 17. Prepare statements per call instead of caching at init (unblocks 15/16)

---

## 15. Fix `reset_db` to also delete `-wal` and `-shm` sidecar files [haiku]

[tests/helpers/test-db.ts](../../tests/helpers/test-db.ts) — `reset_db` currently only deletes `scrollsurf.db`. When statistical tests produce a large WAL file, the orphaned `scrollsurf.db-wal` / `scrollsurf.db-shm` cause SQLite to report corruption (`database disk image is malformed`, `disk I/O error`) in unrelated test files that run afterwards.

Replace the body of `reset_db` so it deletes all three sidecar files before recreating the schema:

```ts
export const reset_db = () => {
  const target_db = path.join(test_dir, 'scrollsurf.db');
  rmSync(target_db, { force: true });
  rmSync(target_db + '-wal', { force: true });
  rmSync(target_db + '-shm', { force: true });
  create_schema(new DatabaseSync(target_db));
  init_db(true);
};
```

The `afterEach` WAL checkpoint in `affinity.test.ts` can stay as a performance improvement but is no longer the safety net.

---

## 16. Add `AFFINITY_STRENGTH=0` test case to `affinity.test.ts` [sonnet]

[tests/lib/db/affinity.test.ts](../../tests/lib/db/affinity.test.ts) — the plan states `AFFINITY_STRENGTH=0` reduces to exactly uniform random, but no test exercises this path.

Add one test that temporarily overrides `AFFINITY_STRENGTH` to `0`:

1. Import `* as affinity_mod` from `@/lib/db/affinity` so the constant can be patched.
2. Insert 200 topic-X + 200 topic-Y articles. Like 20 X articles via `set_like`.
3. Temporarily set `affinity_mod.AFFINITY_STRENGTH = 0` (use `Object.defineProperty` if the export is read-only, or restructure to use a getter).
4. **Deterministic sub-check**: fetch `limit = pool size` (380 unseen) — assert all 380 are returned.
5. **Statistical sub-check**: fetch 100 — assert X-count is between 35 and 65 (near-50/50, not skewed toward liked topic).
6. Restore `AFFINITY_STRENGTH` to its original value in `afterEach`/`finally`.

If patching the exported constant is impractical (ESM live binding), an alternative is to accept an optional `strength` parameter in `WEIGHTED_RANDOM_ORDER_BY` and thread it through — but prefer the simpler patch approach first.

**Done** via the `strength` parameter alternative (`weighted_random_order_by(strength)` threaded through `get_next_*_internal`).

---

## 17. Prepare statements per call instead of caching at init

Task 15's `init_db(true)` replaces the singleton `DatabaseSync`, but the db modules (`articles.ts`, `pictures.ts`, `settings.ts`, `topics.ts`, `votes.ts`, `users.ts`) cached prepared statements in a module-level `stmts` object bound to the *old* connection. After each `reset_db`, helpers wrote to the new database file while cached statements kept reading/writing the previous (unlinked) one — causing stale reads, wrong counts, and FOREIGN KEY failures across the suite.

Fix: removed all module-level `stmts` caches; every function now prepares its statements from `get_db()` on each call (SQL strings stay as module-level constants). Statements used in loops are prepared once per function call.
