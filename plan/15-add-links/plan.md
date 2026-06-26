# Flatten feed-item topics/categories into a single `links: Link[]`

## Context

Today every feed item carries two separate tag collections that the UI has to
understand structurally:

- `topics: Topic[]`, where `Topic = { dataset, topic, bucket, dataset_url }`
- `categories: string[]`

[CardTags.tsx](src/components/CardTags.tsx) then contains all the presentation
logic: it dedups topics by `dataset::bucket`, builds the topic URL from
`dataset_url` + the raw `topic`, decides which chips link where, and renders a
dataset chip + a bucket chip per topic plus a category chip per category.

The **bucket** is really a backend concept — it exists so affinity can group
fine-grained topics ([affinity.ts](src/lib/db/affinity.ts) joins
`topic_buckets`). The frontend shouldn't need to know about buckets, datasets,
URL construction, or category-vs-topic distinctions beyond "what kind of chip is
this and where does it link."

**Goal:** the backend resolves each item's chips into a flat list of
`Link { title, url, type }`. The frontend just renders them. No `Topic` type, no
`topics`/`categories` fields, no bucket on the client.

The DB schema, importers, download pipeline, affinity grouping, and the dev-only
category tree (`get_category_tree`/`TopicStat`/`CategoryTree`) are **unchanged** —
this is a presentation-layer reshape only.

## Changes

### 1. `src/lib/db/types.ts`

- Add:
  ```ts
  export interface Link {
    title: string;
    url: string | null; // null only for a dataset/topic chip whose dataset has no source_url
    type: 'dataset' | 'topic' | 'category';
  }
  ```
  **Decision (investigated):** `datasets.source_url` is nullable `TEXT`, filled
  from each reference DB's `metadata.source_url`. Every current download script
  writes that key, so dataset/topic links always have a URL in practice; category
  links always do (URL built from the name). The only way to get a null URL is a
  future dataset that omits `source_url`. We keep `url: string | null` and render
  such a chip non-clickable (exactly today's behavior) rather than dropping it.
- `BaseFeedItem` gains `links: Link[]`.
- **Remove** the `Topic` interface.
- **Remove** `topics` from `Article`, `Picture`, `Quote`, and `categories` from
  `Article` and `Picture`.
- Keep `LinkType` (`'title' | 'by' | 'category' | 'topic' | 'dataset'`) — it's the
  click-tracking kind and still needs `title`/`by` for the primary card links.
  `Link['type']` is the chip subset of it.
- Keep `TopicStat` / `CategoryGroup` / `CategoryTree` untouched (separate dev-only
  category-tree feature; its `topic` field is a category name, not a feed topic).

### 2. New `src/lib/db/links.ts` (replaces `fetch_topics_for_items`)

Add `fetch_links_for_items(ids): Map<number, Link[]>` that produces the exact chip
list the UI renders today, but resolved server-side. It folds together what was
split between [topics.ts](src/lib/db/topics.ts) and CardTags:

**Cardinality (explicit):** dataset and topic are always **two separate `Link`
entries — never merged into one.** Per unique `dataset::bucket` pair we emit a
dataset link *and* a topic link. So the count scales with the pairs:

- An item in 1 dataset with 1 bucket → 2 links (1 dataset + 1 topic) + categories.
- An item in 2 datasets → 4 links (dataset₁, topic₁, dataset₂, topic₂) + categories.
- Categories → **one link per visible category**, appended after.

This is byte-identical to today's CardTags output (which already renders a dataset
chip + a bucket chip per pair); we're only moving the construction server-side.

- Run the existing topic query (the `SELECT … COALESCE(tb.bucket, it.topic) AS
  bucket … JOIN datasets d` from `fetch_topics_for_items`).
- Per unique `dataset::bucket` (preserving today's dedup + ordering), emit the two
  separate links:
  - `{ type: 'dataset', title: dataset, url: source_url }`
  - `{ type: 'topic', title: bucket, url: source_url ? `${source_url}/${topic.replace(/ /g,'_')}` : null }`
    — i.e. move CardTags' `topic_url` construction here.
- Then append one category link per visible category by reusing
  [`fetch_visible_categories`](src/lib/db/categories.ts):
  `{ type: 'category', title: name, url: `https://en.wikipedia.org/wiki/Category:${encodeURIComponent(name)}` }`.

`Link.url` is `string | null` (see types decision above); CardTags renders a
null-url chip as non-clickable, matching today.

- Remove `fetch_topics_for_items` from [topics.ts](src/lib/db/topics.ts) (leave
  `get_category_tree` there).

### 3. `articles.ts` / `pictures.ts` / `quotes.ts`

- `row_to_article` / `row_to_picture` / `row_to_quote` take a single
  `links: Link[]` arg instead of `(topics, categories)` / `topics`.
- `ArticleDbRow` / `PictureDbRow` / `QuoteDbRow` omit `links` (was `topics`,
  `categories`).
- In each `fetch_*_by_ids`, replace the `fetch_topics_for_items` +
  `fetch_visible_categories` calls with one `fetch_links_for_items(ids)`.
- Quotes already had no categories — same single call works (no category rows).

### 4. `src/lib/db/index.ts`

Export `Link`; drop nothing else (the `Topic` type was never re-exported here).

### 5. `src/components/CardTags.tsx`

- Prop becomes `links: Link[]` (drop `topics` / `categories`).
- Delete the dedup IIFE and `topic_url` construction — now just
  `links.map(link => <Chip … />)`.
- Style by `link.type`: `dataset`/`topic` → `color="primary" variant="outlined"`
  + `accent_sx`; `category` → plain `variant="outlined"` (current category look).
- `href = link.url`; `data-testid = `link-${link.type}``;
  `onClick = () => onTrack(link.type, link.title)` (tracking label becomes the
  visible chip text — already true for dataset/category; for topic it changes from
  raw `topic` to `bucket`, which the e2e test reads from chip text so it stays
  green).
- Keep the overflow/expand logic; its `useLayoutEffect` dep becomes `[links]`.

### 6. `ArticleCard.tsx` / `PictureCard.tsx`

Replace `topics={…} categories={…}` with `links={item.links}`. **QuoteCard:
keep no chips** (confirmed) — quotes carry `links` on the type but the card
ignores them, so there's no quote visual change.

### 7. Tests

- `tests/lib/db/articles.test.ts`, `pictures.test.ts`, `quotes.test.ts`: change
  assertions from `.topics` / `.categories` to `.links` (assert presence of the
  expected `{ type, title, url }` links). Test **helpers** in
  [tests/helpers/test-db.ts](tests/helpers/test-db.ts) keep inserting into
  `item_topics` / `item_categories` (backend unchanged) — only the assertions move.
- `tests/lib/db/topics.test.ts` is about `get_category_tree` — **unchanged**.
- `tests/actions.test.ts` uses helpers, not `.topics` on results — verify it still
  compiles (it inserts via helper `topics:` arg, which stays).
- e2e [likes-clicks.spec.ts](e2e/tests/likes-clicks.spec.ts) iterates
  `['dataset','topic','category']` testids and compares chip text to recorded
  label — stays valid since tracking label is now the chip text. No e2e fixture
  change. Re-run visual snapshots only if chip output shifts (it shouldn't).

## Verification

1. `npm run check` (type-check + lint) — must pass; then `npm run check-fix`.
2. `npm test` — unit suite green (esp. articles/pictures/quotes/topics tests).
3. `npm run test:e2e` — link-click recording + visual snapshots; if chip rendering
   is intentionally identical, snapshots pass unchanged; otherwise
   `npm run test:e2e:update`.
4. Manual `npm run dev`: confirm a card shows dataset + topic + category chips that
   link to the same destinations as before and still track clicks.

## Out of scope / unchanged

DB migrations, `item_topics`/`topic_buckets`/`datasets`/`item_categories` schema,
importers, download scripts, affinity grouping, `get_category_tree` and its
`TopicStat`/`CategoryTree` types.
