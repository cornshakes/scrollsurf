# Tasks: Replace string-packed subqueries with batch follow-up queries

Implementation order. Each task is self-contained and leaves the tree compiling
(except where noted). The plan ([plan.md](plan.md)) contains the exact code for
most of these — follow it.

## Table of contents

- [x] 1. [haiku] Add `fetch_topics_by_item` helper to `topics.ts` (additive)
- [x] 2. [sonnet] Refactor `articles.ts` to batch-fetch topics + categories
- [x] 3. [haiku] Refactor `pictures.ts` to batch-fetch topics (mirror of articles)
- [x] 4. [haiku] Delete now-dead `topics_subquery` / `parse_topics_str` from `topics.ts`
- [x] 5. [sonnet] Reframe existing tests and add coverage for the batch helpers

---

## 1. [haiku] Add `fetch_topics_by_item` helper to `topics.ts`

Purely additive — do not remove anything yet (other files still import the old
helpers). Add the exported `fetch_topics_by_item` function to
[src/lib/db/topics.ts](../../src/lib/db/topics.ts) exactly as written in the
plan's "New batch-fetch helpers" section:

- Signature `(topics_table: string, item_id_col: string, ids: number[]) => Map<number, Topic[]>`.
- Empty-`ids` guard returns the empty map (avoids `IN ()`).
- Build `?` placeholders from `ids`, `LEFT JOIN datasets` for `source_url`,
  positional binding with `.all(...ids)`.
- Map each row into a plain object literal `{ dataset, topic, dataset_url }`
  (`dataset_url: r.source_url ?? null`).

Prepare the statement per call — do not cache it (see CLAUDE.md and
[[prefer-fixing-prod-code-over-test-workarounds]]).

## 2. [sonnet] Refactor `articles.ts` to batch-fetch topics + categories

In [src/lib/db/articles.ts](../../src/lib/db/articles.ts):

1. Add the `fetch_visible_categories` helper exactly as in the plan (article-only,
   joins `article_categories` → `categories`, filters `c.hidden = 0`, positional
   `IN (…)`, empty-`ids` guard, returns `Map<number, string[]>`).
2. Drop `VISIBLE_CATEGORIES_SUBQUERY` and `ARTICLE_TOPICS_SUBQUERY` and remove the
   `AS visible_categories` / `AS article_topics_str` columns from both
   `ARTICLE_GET_NEXT_SQL` and `ARTICLE_GET_VOTED_SQL`. Everything else in those
   SELECTs stays byte-for-byte (the `EXISTS` topics filter, affinity CTEs,
   weighted-random ordering, `ORDER BY a.id DESC`).
3. Change `ArticleDbRow` to `Omit<Article, 'type' | 'categories' | 'topics'>`
   (remove the two synthetic `*_str` fields).
4. Change `row_to_article` to `(r, topics: Topic[], categories: string[])` and set
   `categories` / `topics` from the params (see plan).
5. Rewire `get_next_articles_internal` and `get_voted_articles`: after fetching
   rows, `const ids = rows.map((r) => r.id)`, call
   `fetch_topics_by_item('article_topics', 'article_id', ids)` and
   `fetch_visible_categories(ids)`, then
   `rows.map((r) => row_to_article(r, topics_by_id.get(r.id) ?? [], cats_by_id.get(r.id) ?? []))`.
   Leave the existing mark-seen `BEGIN/COMMIT` block exactly where it is.
6. Update imports: import `Topic` from `./types`; keep importing from `./topics`
   but now `fetch_topics_by_item` instead of `topics_subquery` / `parse_topics_str`.

## 3. [haiku] Refactor `pictures.ts` to batch-fetch topics

Mirror of task 2 but topics-only (pictures have no categories). Use
[src/lib/db/articles.ts](../../src/lib/db/articles.ts) from task 2 as the worked
example. In [src/lib/db/pictures.ts](../../src/lib/db/pictures.ts):

1. Remove `PICTURE_TOPICS_SUBQUERY` and the `AS picture_topics_str` column from
   `PICTURE_GET_NEXT_SQL` and `PICTURE_GET_VOTED_SQL` (rest unchanged).
2. Change `PictureDbRow` to `Omit<Picture, 'type' | 'topics'>`.
3. Change `row_to_picture` to `(r, topics: Topic[])` and set `topics` from the param.
4. In `get_next_pictures_internal` and `get_voted_pictures`, collect
   `ids = rows.map((r) => r.id)`, call
   `fetch_topics_by_item('picture_topics', 'picture_id', ids)`, and
   `rows.map((r) => row_to_picture(r, topics_by_id.get(r.id) ?? []))`. Leave the
   mark-seen transaction in place.
5. Update imports: `Topic` from `./types`, `fetch_topics_by_item` from `./topics`
   (drop `topics_subquery` / `parse_topics_str`).

## 4. [haiku] Delete dead code from `topics.ts`

After tasks 2 and 3 nothing imports them. Delete `topics_subquery` and
`parse_topics_str` (and their leading comments) from
[src/lib/db/topics.ts](../../src/lib/db/topics.ts). Leave `get_category_tree` and
everything else untouched. Confirm with grep that no `GROUP_CONCAT`, `'|||'`,
`split('|||')`, or `parse_topics_str` references remain in `src/`.

## 5. [sonnet] Reframe existing tests and add helper coverage

In [tests/lib/db/articles.test.ts](../../tests/lib/db/articles.test.ts) (and the
sibling `pictures.test.ts` / `topics.test.ts` as relevant):

Reframe the two tests that name the old mechanism — assertions stay, only
intent/name changes:
- `'parses |||-delimited categories correctly'` → `'returns all visible categories'`.
- `'correctly parses topic names containing :: (e.g. Science::Physics)'` → keep as
  a regression test that a `::`-containing topic name round-trips intact (it now
  proves the value is never parsed).

Add focused coverage for the batch helpers (see plan's Testing section):
- **Multiple items, mixed relations in one batch** — several articles with
  differing topic/category counts (incl. one with multiple topics, and one whose
  topics make it eligible vs excluded by the `EXISTS` filter); assert each item
  gets exactly its own topics/categories with no cross-leak.
- **`dataset_url` populated vs null** — one topic whose dataset has a `source_url`,
  one whose dataset has none; assert URL vs `null`.
- **Hidden categories excluded** — insert a category with `hidden = 1` (set
  directly via `db.prepare`, like `insert_category_hierarchy` does) and assert it
  does not appear.

The existing "excludes already-seen" / "returns 0" tests already cover the
empty-`ids` path — verify they still pass rather than adding a new one. No
`test-db` helper changes are needed.

---

## Review 1 fixes

- [x] 6. [haiku] Remove redundant first UPDATE in `dataset_url` test
- [x] 7. [sonnet] Add batch/no-cross-leak test for pictures
- [x] 8. [haiku] Fix stale comment in `pictures.test.ts`

---

## 6. [haiku] Remove redundant first UPDATE in `dataset_url` test

In [tests/lib/db/articles.test.ts](../../tests/lib/db/articles.test.ts) around
line 142, the `dataset_url` test runs an `UPDATE datasets SET source_url = ?
WHERE name = ?` before calling `insert_article`. That first UPDATE affects 0
rows because `insert_article` is what creates the `datasets` row (via `INSERT
OR IGNORE INTO datasets`). The test passes only because a second identical
UPDATE runs after the insert.

Delete the first `get_db().prepare('UPDATE datasets …').run(…)` call (the one
that appears before `insert_article`). Leave the second UPDATE and everything
else untouched.

## 7. [sonnet] Add batch/no-cross-leak test for pictures

In [tests/lib/db/pictures.test.ts](../../tests/lib/db/pictures.test.ts), add a
test analogous to the articles `'batch fetch: each article gets exactly its own
topics and categories with no cross-leak'`. Use two pictures with distinct topic
sets and assert that each returned picture contains only its own topics and none
from the other. The test can call `get_next_feed` (or
`get_next_pictures_internal` directly, since it is now exported) — whichever is
simpler given the existing test helpers. Existing `test-db` helpers are
sufficient; no new helpers needed.

## 8. [haiku] Fix stale comment in `pictures.test.ts`

In [tests/lib/db/pictures.test.ts](../../tests/lib/db/pictures.test.ts) at
lines 5–8 there is a comment that says `get_next_pictures_internal` is not
exported, directly above an import of that function. The function is exported,
so the comment is wrong. Delete the comment line.
