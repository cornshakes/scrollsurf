# Review 2

**Reviewer:** claude-opus-4-8
**Status:** `npm run check` ✅ (tsc + eslint, clean) `npm test` ✅ (89 tests, 9 suites)
**Grep clean:** no `GROUP_CONCAT`, `'|||'`, `split('|||')`, `parse_topics_str`, or `topics_subquery` in `src/`

---

## Overall

The refactor is complete and faithful to the plan, and every actionable item
from [review-1.md](review-1.md) has been addressed. `GROUP_CONCAT` + `::`/`|||`
packing and the `parse_topics_str` parser are gone; in their place are two
batch helpers (`fetch_topics_by_item`, `fetch_visible_categories`) that prepare
a statement per call, guard the empty-`ids` case, bind positionally over an
`IN (…)` list, and return `Map`s of plain object literals safe for server-action
serialization. All four read paths (article/picture × get-next/voted) follow the
identical fetch-rows → collect-ids → batch-fetch → map shape, and the mark-seen
`BEGIN/COMMIT` transaction is untouched and correctly positioned before the
relation maps. Both `*_str` synthetic row fields are eliminated from the types
and SELECTs.

This is a behavior-preserving change validated by the pre-existing tests staying
green plus four new focused tests.

---

## Review-1 follow-ups — all resolved

| # | Task | Status |
|---|---|---|
| 6 | Remove redundant first `UPDATE datasets` in `dataset_url` test | ✅ only one UPDATE remains ([articles.test.ts:151](../../tests/lib/db/articles.test.ts#L151)), now correctly after `insert_article` |
| 7 | Add batch/no-cross-leak test for pictures | ✅ [pictures.test.ts](../../tests/lib/db/pictures.test.ts) `'batch fetch: each picture gets exactly its own topics with no cross-leak'` (two pictures, distinct topic sets, no leak) |
| 8 | Fix stale "not exported" comment in `pictures.test.ts` | ✅ comment block deleted; import remains |

The only Review-1 entry not "fixed" is the SQL identifier-interpolation
*observation* (#3), which was explicitly noted as intentional (per plan) with no
action requested — still accurate, see below.

---

## Checklist vs Plan

| Item | Status |
|---|---|
| `fetch_topics_by_item` — signature, empty-ids guard, positional `?`, `LEFT JOIN datasets`, plain literals | ✅ matches plan exactly |
| `fetch_visible_categories` — `c.hidden = 0` filter, empty-ids guard, `Map<number, string[]>` | ✅ matches plan exactly |
| `topics_subquery` / `parse_topics_str` / `VISIBLE_CATEGORIES_SUBQUERY` / `ARTICLE_TOPICS_SUBQUERY` / `PICTURE_TOPICS_SUBQUERY` removed | ✅ |
| `*_str` fields gone from row types + SELECTs | ✅ |
| `row_to_article(r, topics, categories)` / `row_to_picture(r, topics)` | ✅ |
| mark-seen `BEGIN/COMMIT` untouched, runs after relation fetches | ✅ |
| Main SELECTs otherwise byte-for-byte (EXISTS filter, affinity CTEs, weighted-random, `ORDER BY id DESC`) | ✅ |
| Reframed tests (visible categories / `::` regression) | ✅ |
| New tests: articles cross-leak, dataset_url populated-vs-null, hidden excluded, pictures cross-leak | ✅ all 4 present and green |
| `get_category_tree` / affinity untouched, no schema changes | ✅ |
| Grep clean in `src/` | ✅ |

---

## Issues

None blocking. Two minor observations, neither requiring a change.

### Observation: identifier interpolation in `fetch_topics_by_item` (carried from Review 1)

[src/lib/db/topics.ts:14-21](../../src/lib/db/topics.ts#L14)

`item_id_col` and `topics_table` are interpolated directly into the SQL string.
This is by design (the plan specifies it) and safe today — both call sites pass
hardcoded literals (`'article_topics'`/`'article_id'`,
`'picture_topics'`/`'picture_id'`). The value rows are still bound as
parameters. No action; noting only for the same future-proofing reason Review 1
gave. A whitelist check would be the mitigation if the function ever takes
caller-supplied identifiers.

### Observation: relation fetch order is not asserted

`fetch_topics_by_item` / `fetch_visible_categories` preserve SQLite's natural
row order, and the new cross-leak tests `.sort()` before comparing, so per-item
ordering of topics/categories is intentionally not pinned. This is the right
call — the prior `GROUP_CONCAT` ordering was likewise unspecified, so asserting
an order would over-constrain. Mentioning only so it is a conscious choice on
record: nothing downstream relies on topic/category order.

---

## Verdict

Ship it. The refactor meets every point of the plan, the Review-1 fixes are all
in, the suite is green (89/89), and the grep/typecheck gates pass. No remaining
actionable findings.
