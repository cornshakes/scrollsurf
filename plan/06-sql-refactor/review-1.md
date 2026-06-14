# Review 1

**Reviewer:** claude-sonnet-4-6  
**Status:** `npm run check` ✅  `npm test` ✅ (88 tests, 9 suites)  
**Grep clean:** no `GROUP_CONCAT`, `'|||'`, `split('|||')`, or `parse_topics_str` in `src/`

---

## Overall

Clean, faithful implementation of the plan. The core refactor is correct: `GROUP_CONCAT` + delimiter parsing is gone, replaced by two well-shaped batch helpers that each prepare a statement per call (matching the codebase convention). All four read paths (articles get-next, articles voted, pictures get-next, pictures voted) follow the same shape. `row_to_article` and `row_to_picture` now accept plain `topics`/`categories` params, eliminating the synthetic `*_str` row fields entirely.

---

## Issues

### Minor: Redundant UPDATE in `dataset_url` test

[tests/lib/db/articles.test.ts:142-144](../../tests/lib/db/articles.test.ts#L142)

```ts
get_db()
  .prepare('UPDATE datasets SET source_url = ? WHERE name = ?')
  .run('https://example.com/dataset', 'WithUrl');   // <- no-op: 'WithUrl' doesn't exist yet
insert_article({ ... topics: [{ dataset: 'WithUrl', ... }] });
get_db()
  .prepare('UPDATE datasets SET source_url = ? WHERE name = ?')
  .run('https://example.com/dataset', 'WithUrl');   // <- does the actual work
```

The first UPDATE affects 0 rows because `insert_article` is what creates the `datasets` row (via `INSERT OR IGNORE INTO datasets`). The test passes because the second UPDATE happens after the insert. Functionally harmless but misleading — looks like the author put the first UPDATE in the wrong place. The fix is to remove the first UPDATE entirely.

### Minor: No batch/no-cross-leak test for pictures

The articles test suite adds `'batch fetch: each article gets exactly its own topics and categories with no cross-leak'`. The plan's testing section describes this as a regression guard for the batch grouping. The pictures side has the same grouping code in `get_next_pictures_internal` and `get_voted_pictures`, but pictures.test.ts has no equivalent multi-item cross-leak test. Since `fetch_topics_by_item` is shared, the articles tests do partially cover the helper, but a picture-specific case with two pictures having different topics would close the gap cleanly.

### Observation: Table/column names interpolated into SQL

[src/lib/db/topics.ts:15-21](../../src/lib/db/topics.ts#L15)

```ts
`SELECT t.${item_id_col} AS item_id, …
 FROM ${topics_table} t
 …
 WHERE t.${item_id_col} IN (${placeholders})`
```

`topics_table` and `item_id_col` are interpolated directly. All current call sites pass hardcoded string literals, so there is no injection risk today. This design is explicitly from the plan, so it is intentional. Worth noting: if this function is ever called from a less-controlled context the lack of a whitelist validation would become a real concern.

### Pre-existing / cosmetic: Stale comment in pictures.test.ts

[tests/lib/db/pictures.test.ts:5-8](../../tests/lib/db/pictures.test.ts#L5)

```ts
// get_next_pictures_internal is not exported — test it via get_next_feed …
import { get_next_pictures_internal } from '@/lib/db/pictures';
```

The comment says the function is not exported, but it is. The import works fine. This predates the refactor and the plan does not mention it; flagging only for completeness.

---

## Checklist vs Plan

| Item | Status |
|---|---|
| `fetch_topics_by_item` signature, empty-ids guard, positional `?` binding, `LEFT JOIN datasets`, plain object literals | ✅ matches plan exactly |
| `fetch_visible_categories` — hidden filter, empty-ids guard, `Map<number, string[]>` | ✅ matches plan exactly |
| `VISIBLE_CATEGORIES_SUBQUERY`, `ARTICLE_TOPICS_SUBQUERY`, `PICTURE_TOPICS_SUBQUERY` removed | ✅ |
| `*_str` synthetic fields gone from row types and SELECTs | ✅ |
| `row_to_article` / `row_to_picture` now take `topics`/`categories` params | ✅ |
| mark-seen `BEGIN/COMMIT` block untouched and in correct position | ✅ |
| Test names reframed (categories / `::` regression) | ✅ |
| Batch no-cross-leak test (articles) | ✅ |
| `dataset_url` populated vs null test | ✅ (but has redundant first UPDATE) |
| Hidden categories excluded test | ✅ |
| Batch no-cross-leak test (pictures) | ❌ missing |
| `npm run lint-fix` run after check | not verified (code appears well-formatted) |
