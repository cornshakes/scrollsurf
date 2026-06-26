# Tasks: Flatten feed-item topics/categories into `links: Link[]`

## TOC

- [x] 1. Add `Link` interface and reshape `BaseFeedItem` in `types.ts` [haiku]
- [x] 2. Create `src/lib/db/links.ts` with `fetch_links_for_items` [sonnet]
- [x] 3. Remove `fetch_topics_for_items` from `topics.ts` [haiku]
- [x] 4. Update `articles.ts`, `pictures.ts`, `quotes.ts` to use `fetch_links_for_items` [haiku]
- [x] 5. Export `Link` from `src/lib/db/index.ts` [haiku]
- [x] 6. Simplify `CardTags.tsx` to render `links: Link[]` directly [haiku]
- [x] 7. Update `ArticleCard.tsx` and `PictureCard.tsx` to pass `links={item.links}` [haiku]
- [x] 8. Update unit test assertions from `.topics`/`.categories` to `.links` [haiku]

---

## 1. Add `Link` interface and reshape `BaseFeedItem` in `types.ts` [haiku]

**File:** `src/lib/db/types.ts`

- Add the `Link` interface:
  ```ts
  export interface Link {
    title: string;
    url: string | null;
    type: 'dataset' | 'topic' | 'category';
  }
  ```
- Add `links: Link[]` to `BaseFeedItem`.
- Remove the `Topic` interface entirely.
- Remove `topics` from `Article`, `Picture`, and `Quote`.
- Remove `categories` from `Article` and `Picture`.
- Leave `LinkType`, `TopicStat`, `CategoryGroup`, and `CategoryTree` untouched.

---

## 2. Create `src/lib/db/links.ts` with `fetch_links_for_items` [sonnet]

**File:** `src/lib/db/links.ts` (new file)

Implement `fetch_links_for_items(ids: number[]): Map<number, Link[]>` that resolves all chips server-side, replacing the combination of `fetch_topics_for_items` + CardTags' URL construction:

**Topic/dataset links:**
- Reuse the existing SQL from `fetch_topics_for_items` in `topics.ts` (joins `item_topics`, `topic_buckets`, `datasets`; selects `item_id`, `dataset`, `source_url`, `topic`, and `COALESCE(tb.bucket, it.topic) AS bucket`).
- Group by `item_id`, dedup on `dataset::bucket` (same logic as today's CardTags IIFE).
- Per unique pair emit two `Link` entries in order:
  - `{ type: 'dataset', title: dataset, url: source_url }`
  - `{ type: 'topic', title: bucket, url: source_url ? \`${source_url}/${topic.replace(/ /g,'_')}\` : null }`

**Category links:**
- Call `fetch_visible_categories(ids)` from `categories.ts`.
- Append one `Link` per category:
  - `{ type: 'category', title: name, url: \`https://en.wikipedia.org/wiki/Category:${encodeURIComponent(name)}\` }`

Return a `Map<number, Link[]>` keyed by `item_id`, with topic/dataset links first and category links appended after.

---

## 3. Remove `fetch_topics_for_items` from `topics.ts` [haiku]

**File:** `src/lib/db/topics.ts`

- Delete the `fetch_topics_for_items` function and its SQL.
- Leave `get_category_tree` and all other exports in place.

---

## 4. Update `articles.ts`, `pictures.ts`, `quotes.ts` to use `fetch_links_for_items` [haiku]

**Files:** `src/lib/db/articles.ts`, `src/lib/db/pictures.ts`, `src/lib/db/quotes.ts`

For each file:
- Replace the `fetch_topics_for_items` + `fetch_visible_categories` calls in `fetch_*_by_ids` with a single `fetch_links_for_items(ids)` call.
- Update `row_to_article` / `row_to_picture` / `row_to_quote` to accept `links: Link[]` instead of separate `(topics, categories)` or `topics` args, and write the value directly onto the returned object.
- Remove `topics` and `categories` from `ArticleDbRow` / `PictureDbRow` / `QuoteDbRow` (those types no longer carry them).

---

## 5. Export `Link` from `src/lib/db/index.ts` [haiku]

**File:** `src/lib/db/index.ts`

- Add `Link` to the exports from `types.ts` (or re-export from `links.ts`).
- No other changes needed.

---

## 6. Simplify `CardTags.tsx` to render `links: Link[]` directly [haiku]

**File:** `src/components/CardTags.tsx`

- Change prop from `topics: Topic[], categories: string[]` to `links: Link[]`.
- Delete the dedup IIFE and all `topic_url` construction logic.
- Render `links.map(link => <Chip … />)`:
  - Style: `dataset` and `topic` → `color="primary" variant="outlined"` + `accent_sx`; `category` → `variant="outlined"` (plain, current category look).
  - `href={link.url ?? undefined}` (non-clickable when null).
  - `data-testid={\`link-${link.type}\`}`.
  - `onClick={() => onTrack(link.type, link.title)}`.
- Update the overflow/expand `useLayoutEffect` dep array to `[links]`.

---

## 7. Update `ArticleCard.tsx` and `PictureCard.tsx` to pass `links={item.links}` [haiku]

**Files:** `src/components/ArticleCard.tsx`, `src/components/PictureCard.tsx`

- Replace `topics={item.topics} categories={item.categories}` (or equivalent) with `links={item.links}` on the `<CardTags>` element.
- Remove any now-unused local references to `topics` or `categories`.
- `QuoteCard` has no chips and needs no change.

---

## 8. Update unit test assertions from `.topics`/`.categories` to `.links` [haiku]

**Files:** `tests/lib/db/articles.test.ts`, `tests/lib/db/pictures.test.ts`, `tests/lib/db/quotes.test.ts`

- Replace assertions on `.topics` and `.categories` with assertions on `.links`.
- Assert the expected `{ type, title, url }` shape for each link (dataset, topic, category).
- Test helper inserts in `tests/helpers/test-db.ts` still write to `item_topics` / `item_categories` — leave those unchanged.
- `tests/lib/db/topics.test.ts` covers `get_category_tree` only — no changes needed there.
- Verify `tests/actions.test.ts` still compiles (it uses the helper `topics:` arg which is unchanged).
