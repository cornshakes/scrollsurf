# Review 2 — Topic-Affinity Weighted Feed

## Overall

All three review-1 findings were addressed correctly. The core implementation — `affinity.ts`, the SQL wiring in `articles.ts`/`pictures.ts`, and the CLAUDE.md updates — is solid. However, running the test suite reveals that the statistical tests introduced a regression: 26 tests now fail across 8 test files due to WAL file contamination between tests.

---

## Findings

### 1. Test suite broken — WAL files not cleaned up by `reset_db` (blocking)

Running `npm test` produces 26 failures across 8 test files with errors: `database disk image is malformed` and `disk I/O error`. The failures appear in `users.test.ts`, `feed.test.ts`, `topics.test.ts`, `settings.test.ts`, `actions.test.ts`, and others — i.e. tests that had nothing to do with this feature.

**Root cause:** The statistical tests (tests 1, 2, 3, 6 in `affinity.test.ts`) insert 400+ rows each and generate a large WAL file at `scrollsurf.db-wal`. `reset_db` in `tests/helpers/test-db.ts` (line 22-27) only calls `rmSync(target_db)` — it deletes `scrollsurf.db` but leaves `scrollsurf.db-wal` and `scrollsurf.db-shm` on disk. When the next test opens a fresh empty `scrollsurf.db` at the same path, SQLite finds the orphaned WAL file from the previous (now-deleted) database. The page counts and file headers don't match the new empty DB, so SQLite reports corruption.

The `afterEach` WAL checkpoint added in task 14 is a necessary but insufficient mitigation — it truncates the WAL before `reset_db` runs, but only for `affinity.test.ts`'s own `afterEach`. Other test files that execute later (or in a different Jest worker order) are still vulnerable. More fundamentally, if any test in `affinity.test.ts` fails mid-run and throws before the WAL checkpoint fires, the WAL stays large.

**Fix:** `reset_db` should delete all three SQLite files:

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

This makes cleanup unconditional and removes the dependency on the checkpoint succeeding. The `afterEach` checkpoint in `affinity.test.ts` can stay as a performance improvement (avoids carrying a large WAL into the next test's setup) but is no longer the safety net.

---

### 2. No test for `AFFINITY_STRENGTH=0` / neutral-strength path (minor gap)

The plan states: "`FEED_AFFINITY_STRENGTH=0` reduces to exactly uniform random — strict generalization of the previous behavior." This is a non-trivial correctness claim: with strength 0, `exp(0 · affinity) = 1` for all items, making the ORDER BY expression pure Efraimidis–Spirakis uniform sampling. This is correct mathematically, but there is no test exercising it.

The existing cross-user isolation test (test 6) only verifies that one user's likes don't spill into another user's draw — it doesn't cover the `AFFINITY_STRENGTH=0` code path at all. Worth adding a deterministic test: with `AFFINITY_STRENGTH=0` and 20 liked X articles + 200 X / 200 Y pool, a fetch of `limit = pool size` should return all 400 items (no items excluded), and a statistical draw should fall in the near-50/50 range.

Not a blocker — the code is correct — but the property currently has no regression coverage.

---

## What's correct

- **Review-1 fixes applied correctly**: NaN guard (`isNaN` + fallback to 2.0), WAL checkpoint error logging (`console.warn`), and stale `ORDER BY RANDOM()` sentence in CLAUDE.md are all applied as specified.
- **`affinity.ts` math**: CTE chain (clicked → topic_affinity → item_affinity), the `max(..., 1e-12)` guard on `ln(0)`, the AFFINITY_CLAMP via `min/max`, and the `COALESCE(ia.affinity, 0.0)` fallback for unseen topics are all correct.
- **`WEIGHTED_RANDOM_ORDER_BY` baked at load time**: Consistent with `FEED_PICTURE_RATIO`'s pattern. The SQL string is fixed at startup from the env var, not re-evaluated per query — intentional and correct.
- **`DISTINCT` in `clicked` CTE**: Prevents repeat clicks on the same article from compounding toward that item's topics. Correctly implemented as a pre-aggregation step before the main join.
- **`articles.ts` / `pictures.ts` wiring**: Three changes per file (prefix CTE, LEFT JOIN, ORDER BY replacement) are correct. All other statements (mark_seen, set_like, get_voted) are untouched.
- **Anonymous user / null `user_id` → uniform**: When `$user_id = NULL`, the `WHERE u.user_id = $user_id` clause in `topic_affinity` matches nothing, so both MATERIALIZED CTEs are empty, `item_affinity` has no rows, all articles get `ia.affinity = NULL → COALESCE → 0.0`, and the draw is uniform. Verified by test 5.
- **CLAUDE.md and `.env.example`**: All documentation updates are correct and complete.
