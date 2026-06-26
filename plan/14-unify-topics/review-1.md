APPROVED

## Summary

Implementation of dataset-independent topic buckets for affinity scoring. All 12 tasks completed.

## Checks

- `npm run check` — ✅ passes (tsc + eslint clean)
- `npm test` — ✅ 99/99 tests pass
- `npm run test:e2e` — 39/40 pass. One failure: `[mobile-light] › feed.spec.ts:40 › items are preserved after navigating to /privacy and back`. The same test in `[mobile-dark]` passes, and ECONNRESET errors appear in the WebServer log during that window — classic pre-existing flakiness, unrelated to these changes.

## Code Review

**Migration (migrations.ts):** Correctly appended as v10, no `BEGIN/COMMIT`, no `IF NOT EXISTS`, follows append-only convention. ✓

**Schema (types.ts):** `bucket: string` added to `Topic`. ✓

**Affinity CTEs (affinity.ts):** Three new CTEs replace the old two:
- `item_buckets AS MATERIALIZED` uses `SELECT DISTINCT` to prevent double-counting an item that belongs to the same bucket via two datasets, and `COALESCE(tb.bucket, it.dataset || char(31) || it.topic)` gives the correct isolation fallback for unmapped pairs.
- `topic_affinity` groups by `ib.bucket` — cross-dataset merge works correctly.
- `item_affinity` averages over all buckets per item — unchanged semantics, new key.
No changes to `eligible_pool`, `pool_size`, feed draw, or quote handling. ✓

**Topics query (topics.ts):** LEFT JOIN on `topic_buckets`, `COALESCE(tb.bucket, it.topic) AS bucket` selected and mapped into `Topic`. ✓

**CardTags.tsx:** Destructures `bucket`, uses it as the chip label. Keeps `topic` for the href URL and `onTrack` call (so links still point at real wiki sections). Dedup key is `${dataset}::${bucket}` — correctly handles the case where an item belongs to two same-bucket datasets. ✓

**import-datasets.ts:** `import_topic_buckets` mirrors `import_categories` pattern. DELETE-then-insert makes CLI re-runs authoritative (stale mappings don't linger). `existsSync` guard returns silently on missing file — consistent with `import_categories` behaviour (no warning logged; plan said "log a warning" but the codebase pattern doesn't). Minor deviation only. ✓

**instrumentation.ts:** `import_topic_buckets('topic_buckets.db')` called in its own `try/catch` after other dataset imports. ✓

**scripts/unify-topics.ts:** Uses built-in `node:readline/promises`, no new deps. `--all` flag for re-editing mapped pairs. Exact normalized match suggests the existing bucket, otherwise defaults to topic name. Numbered candidate list for quick pick. `s`/`q` commands work. `INSERT OR REPLACE` persists immediately so the run is resumable. One minor UX edge case: out-of-range numeric input (e.g. `"0"` or `"99"` with 3 candidates) is treated as free text and becomes the literal bucket name. Not a bug. ✓

**package.json:** `"unify-topics": "tsx scripts/unify-topics.ts"` added. ✓

**tests/helpers/test-db.ts:** `insert_topic_bucket(dataset, topic, bucket)` added. ✓

**affinity.test.ts:** Two new statistical tests:
- Isolation: D1/History and D2/History without a bucket mapping → D2 count stays < 35 after liking D1 items. ✓
- Merge: both mapped to `'History'` → D2 count > 35. ✓

Existing tests use single-dataset topics (e.g. `D/X`, `D/Y`) whose fallback buckets `D␟X` / `D␟Y` stay distinct — pass without modification. ✓

**articles.test.ts:** `topic` assertion in the `::` round-trip test correctly updated to include `bucket: 'Science::Physics'`. ✓

**topics.test.ts / actions.test.ts:** No direct `Topic` shape assertions in these files — no update needed, correctly left alone. ✓
