# Plan: Replace string-packed topic/category subqueries with batch follow-up queries

## Goal

Today, the article and picture feed queries pull each item's **topics** (with
dataset + source URL) and **categories** as a single column built by SQLite
`GROUP_CONCAT`, using `|||` and `::` as delimiters, then split back apart in JS.
This is fragile: it forces escaping concerns (topic names can contain `::`),
makes the row types carry synthetic `*_str` fields, and bakes parsing logic into
`parse_topics_str`.

Replace the packing entirely. After the main query returns its rows, run **one
extra query per relation** (topics, categories) that fetches the child rows for
the whole batch of item ids at once, group them in JS, and attach them to each
item. No more `GROUP_CONCAT`, no more delimiter parsing.

This covers both `|||`-packed subqueries that exist today:
- `topics_subquery` (`dataset::topic::source_url` triples) in
  [src/lib/db/topics.ts](../../../scrollsurf/src/lib/db/topics.ts)
- `VISIBLE_CATEGORIES_SUBQUERY` in
  [src/lib/db/articles.ts](../../../scrollsurf/src/lib/db/articles.ts)

Both use the identical pack-then-split anti-pattern over rows that belong to the
same fetched items, so they are refactored together for consistency. (Topics are
the primary target named in the request; categories come along because leaving
one `|||` column behind would be inconsistent and confusing.)

## End state

### New batch-fetch helpers

Two small helpers, each: take the list of item ids already fetched, run a single
prepared query with an `IN (…)` clause, and return a `Map<number, T[]>` keyed by
item id, preserving SQLite's natural row order. Both return plain object literals
(never the null-prototype rows that `DatabaseSync.all()` produces) so the values
are safe to serialize through server actions.

In [src/lib/db/topics.ts](../../../scrollsurf/src/lib/db/topics.ts) — shared by
articles and pictures, since each has its own topics table + id column:

```ts
// Batch-fetch topics for a set of items. Returns item_id -> Topic[].
export const fetch_topics_by_item = (
  topics_table: string, // 'article_topics' | 'picture_topics'
  item_id_col: string,  // 'article_id'    | 'picture_id'
  ids: number[]
): Map<number, Topic[]> => {
  const by_id = new Map<number, Topic[]>();
  if (ids.length === 0) {
    return by_id;
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = get_db()
    .prepare(
      `SELECT t.${item_id_col} AS item_id, t.dataset, t.topic, d.source_url
       FROM ${topics_table} t
       LEFT JOIN datasets d ON d.name = t.dataset
       WHERE t.${item_id_col} IN (${placeholders})`
    )
    .all(...ids) as unknown as {
    item_id: number;
    dataset: string;
    topic: string;
    source_url: string | null;
  }[];
  for (const r of rows) {
    const list = by_id.get(r.item_id) ?? [];
    list.push({ dataset: r.dataset, topic: r.topic, dataset_url: r.source_url ?? null });
    by_id.set(r.item_id, list);
  }
  return by_id;
};
```

In [src/lib/db/articles.ts](../../../scrollsurf/src/lib/db/articles.ts) —
categories are article-only:

```ts
// Batch-fetch visible (non-hidden) category names. Returns article_id -> string[].
const fetch_visible_categories = (ids: number[]): Map<number, string[]> => {
  const by_id = new Map<number, string[]>();
  if (ids.length === 0) {
    return by_id;
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = get_db()
    .prepare(
      `SELECT ac.article_id AS item_id, c.name
       FROM article_categories ac
       JOIN categories c ON ac.category_id = c.id
       WHERE c.hidden = 0 AND ac.article_id IN (${placeholders})`
    )
    .all(...ids) as unknown as { item_id: number; name: string }[];
  for (const r of rows) {
    const list = by_id.get(r.item_id) ?? [];
    list.push(r.name);
    by_id.set(r.item_id, list);
  }
  return by_id;
};
```

Notes:
- Statements are prepared per call (with the right number of `?` placeholders for
  this batch). This matches the established convention — do not cache prepared
  statements. See [[prefer-fixing-prod-code-over-test-workarounds]].
- Positional `?` binding is used here (the rest of the file uses named `$params`);
  mixing is per-statement and fine, and positional is the natural fit for a
  variable-length `IN` list.
- The empty-`ids` guard avoids the `IN ()` syntax error and an empty round-trip.

### Removed code

- `topics_subquery` and `parse_topics_str` (and its `::`/`|||` parsing) — deleted
  from [topics.ts](../../../scrollsurf/src/lib/db/topics.ts).
- `VISIBLE_CATEGORIES_SUBQUERY`, `ARTICLE_TOPICS_SUBQUERY` and the `.split('|||')`
  call — deleted from [articles.ts](../../../scrollsurf/src/lib/db/articles.ts).
- `PICTURE_TOPICS_SUBQUERY` — deleted from
  [pictures.ts](../../../scrollsurf/src/lib/db/pictures.ts).

### Updated row types and mappers

The synthetic columns disappear from the SELECTs and the row types:

```ts
// articles.ts
type ArticleDbRow = Omit<Article, 'type' | 'categories' | 'topics'>;

export const row_to_article = (
  r: ArticleDbRow,
  topics: Topic[],
  categories: string[]
): Article => ({
  type: 'article',
  id: r.id,
  title: r.title,
  extract: r.extract,
  url: r.url,
  like: r.like,
  description: r.description,
  image_url: r.image_url,
  categories,
  topics,
});
```

```ts
// pictures.ts
type PictureDbRow = Omit<Picture, 'type' | 'topics'>;

const row_to_picture = (r: PictureDbRow, topics: Topic[]): Picture => ({ … topics });
```

The four main SELECTs (`ARTICLE_GET_NEXT_SQL`, `ARTICLE_GET_VOTED_SQL`,
`PICTURE_GET_NEXT_SQL`, `PICTURE_GET_VOTED_SQL`) drop the `… AS *_str` /
`AS visible_categories` columns and otherwise stay exactly as-is (including the
`EXISTS (… topics)` filter, the affinity CTEs, the weighted-random ordering, and
the `ORDER BY id DESC` on the voted queries).

### Updated call sites

Each of the four read paths gains the same shape: fetch rows → collect ids →
batch-fetch relations → map with attached relations. Example for the article
fetch:

```ts
const rows = get_next.all({ $limit: limit, $user_id: user_id }) as unknown as ArticleDbRow[];
const ids = rows.map((r) => r.id);
const topics_by_id = fetch_topics_by_item('article_topics', 'article_id', ids);
const cats_by_id = fetch_visible_categories(ids);
// … existing mark-seen transaction unchanged …
return rows.map((r) =>
  row_to_article(r, topics_by_id.get(r.id) ?? [], cats_by_id.get(r.id) ?? [])
);
```

- `get_next_articles_internal` and `get_voted_articles` use both helpers.
- `get_next_pictures_internal` and `get_voted_pictures` use only
  `fetch_topics_by_item` (with `'picture_topics'`, `'picture_id'`).
- The existing mark-seen `BEGIN/COMMIT` block stays where it is; the relation
  fetches are plain reads and run alongside it. `get_next_feed`
  ([feed.ts](../../../scrollsurf/src/lib/db/feed.ts)) is unaffected — it consumes
  the already-mapped `Article`/`Picture` objects.

## Why an extra query (not a JOIN into the main query)

A JOIN would re-introduce the fan-out the `GROUP_CONCAT` was avoiding (one item
row × N topics × M categories), which would also break `LIMIT` and the
weighted-random row ordering. A small fixed number of follow-up queries (1–2),
each batched over all ids in the page, keeps the main query producing exactly one
row per item while reading each relation in a single round-trip. Page sizes are
small (feed batches), so this is well within SQLite's parameter limits and is
effectively two extra cheap indexed lookups per page.

## Testing

Existing tests in
[tests/lib/db/articles.test.ts](../../../scrollsurf/tests/lib/db/articles.test.ts),
[pictures.test.ts](../../../scrollsurf/tests/lib/db/pictures.test.ts), and
[topics.test.ts](../../../scrollsurf/tests/lib/db/topics.test.ts) already cover
the observable behavior (topics, categories, dataset URLs, ordering) and must
keep passing unchanged — that is the primary correctness signal that the refactor
is behavior-preserving.

Two tests reference the old mechanism by name and should be reframed (the
assertions stay, only the intent/name changes since there is no longer any
delimiter):

- `'parses |||-delimited categories correctly'` →
  `'returns all visible categories'` (asserts both categories come back).
- `'correctly parses topic names containing :: (e.g. Science::Physics)'` →
  keep as a regression test that a topic name containing `::` round-trips intact;
  it now proves the value is no longer parsed at all. This is the key win and
  must stay green.

Add focused coverage for the new helpers:

- **Multiple items, mixed relations in one batch** — insert several articles with
  different topic/category counts (including one with zero topics-but-present so
  it is excluded by the `EXISTS` filter, and one with multiple topics); assert
  each returned article gets exactly its own topics/categories and none leak
  across items. This is the regression guard for the batch grouping.
- **Empty input** — a call path that fetches zero rows returns `[]` and issues no
  malformed `IN ()` query (covered naturally by the existing "excludes
  already-seen" / "returns 0" tests; verify they still pass).
- **`dataset_url` populated vs null** — one topic whose dataset has a
  `source_url` in `datasets`, one whose dataset has none; assert `dataset_url` is
  the URL and `null` respectively (mirrors current behavior of the `LEFT JOIN`).
- **Hidden categories excluded** — insert a hidden category and assert it does not
  appear (the `c.hidden = 0` filter moved from subquery to the new query).

The `test-db` helpers
([tests/helpers/test-db.ts](../../../scrollsurf/tests/helpers/test-db.ts))
already insert topics, datasets, and categories, so no helper changes are needed;
a hidden-category test may set `categories.hidden = 1` directly via `db.prepare`,
as `insert_category_hierarchy` does for its table.

## Out of scope / leave alone

- `get_category_tree` in [topics.ts](../../../scrollsurf/src/lib/db/topics.ts)
  already uses `GROUP BY` with real columns (no string packing) — untouched.
- Affinity CTEs in [affinity.ts](../../../scrollsurf/src/lib/db/affinity.ts) — no
  string packing there.
- No schema/migration changes. No dataset re-download
  (see [[datasets-are-download-once-no-backfill]]).

## Verification checklist

1. `npm run check` (tsc + eslint) passes — confirms the `*_str` fields are gone
   from every type and call site.
2. `npm run lint-fix` for formatting (per CLAUDE.md, after type-check passes).
3. `npm test` green, including the reframed and new db tests.
4. Grep confirms no remaining `GROUP_CONCAT`, `'|||'`, or `split('|||')` /
   `parse_topics_str` references in `src/`.
