# Tasks: Add Wikiquote QOTD quotes as a third feed type

## TOC

- [x] 1. Add `Quote` type to `src/lib/db/types.ts` [haiku]
- [x] 2. Add migration for `quotes` table in `src/lib/db/migrations.ts` [haiku]
- [x] 3. Create `scripts/lib/wikiquote.ts` API client [haiku]
- [x] 4. Create `scripts/lib/quotes-dataset.ts` reference schema + orchestration [sonnet]
- [x] 5. Create `scripts/datasets/download-quotes.ts` download script [sonnet]
- [x] 6. Add `download-quotes` script to `package.json` [haiku]
- [x] 7. Add `import_quotes_dataset` to `src/lib/import-datasets.ts` and wire into `src/instrumentation.ts` [haiku]
- [x] 8. Create `src/lib/db/quotes.ts` and export from `src/lib/db/index.ts` [haiku]
- [x] 9. Generalize `FEED_PICTURE_RATIO` to `FEED_TYPE_SHARES` in `src/lib/db/feed.ts` [sonnet]
- [x] 10. Add quote payload branch to `src/lib/db/feed.ts` [haiku]
- [x] 11. Widen type unions in `src/lib/db/votes.ts` and `src/app/actions.ts` [haiku]
- [x] 12. Create `src/components/QuoteCard.tsx` [haiku]
- [x] 13. Extend `RandomFeed.tsx` and `VotedFeed.tsx` to dispatch `QuoteCard` [haiku]
- [x] 14. Add `insert_quote` test helper and `tests/lib/db/quotes.test.ts` [sonnet]
- [x] 15. Update ratio-related tests for `FEED_TYPE_SHARES` and bump `migrate.test.ts` [haiku]
- [x] 16. Update E2e: seed a quote, widen `ClickRow.item_type`, add card screenshot [haiku]
- [x] 17. Update docs: `CLAUDE.md`, `README.md`, `.env.example` [haiku]

# Review 1

- [x] R1-1. Fix e2e scroll-position regression caused by quote cards [haiku]

---

## Task Details

### 1. Add `Quote` type to `src/lib/db/types.ts`

Extend the `FeedItem` union with a new `Quote` interface.

```ts
export type Quote extends BaseFeedItem {
  type: 'quote';
  author: string;
  author_url: string | null;
  topics: Topic[];
}
```

Add `Quote` to the `FeedItem = Article | Picture | Quote` union. No other changes needed.

---

### 2. Add migration for `quotes` table in `src/lib/db/migrations.ts`

Verify the current migration head (expect `user_version` 5), then append migration **6**:

```sql
CREATE TABLE quotes (
  item_id    INTEGER PRIMARY KEY REFERENCES items(id),
  author     TEXT NOT NULL,
  author_url TEXT
);
```

No `BEGIN/COMMIT`, no non-transactional PRAGMAs inside the migration body — the runner owns the transaction.

---

### 3. Create `scripts/lib/wikiquote.ts` API client

Mirror `scripts/lib/wiki.ts` exactly, pointing at Wikiquote instead of Wikipedia:

```ts
export const wiki_api = create_mediawiki_api('https://en.wikiquote.org/w/api.php');
```

Routes all calls through the shared `scripts/lib/mediawiki.ts` client (etiquette, backoff, gzip, UA). Reuses `WIKIPEDIA_USER_AGENT` — no new env var.

---

### 4. Create `scripts/lib/quotes-dataset.ts` reference schema + orchestration

Two-phase discover→download module, mirroring `scripts/lib/pictures-dataset.ts`.

**Reference DB schema** (created fresh by the download script):
- `metadata(key TEXT PRIMARY KEY, value TEXT)` — stores `title='Quotes'`, `source_url='https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month'`.
- `quotes(text TEXT, url TEXT UNIQUE, author TEXT, author_url TEXT)`.
- `discovered_quotes(url TEXT PRIMARY KEY, text TEXT, author TEXT, author_url TEXT)`.
- `discovered_months(page TEXT PRIMARY KEY, done INTEGER DEFAULT 0)` — month-granularity resumability; skip months already fully fetched.

No `quote_topics` table — the single fixed topic `(dataset='Quotes', topic='Quote of the Day')` is applied at import time.

Export the schema setup and insert helpers used by the download script.

---

### 5. Create `scripts/datasets/download-quotes.ts` download script

Discovery + download in two phases, serial through `scripts/lib/mediawiki.ts`.

**Discovery phase:**
1. Fetch the QOTD-by-month index page to enumerate monthly subpage titles.
2. Filter to a configurable recent-years range (e.g. last 3 years) to avoid older format variance.
3. Record each month page in `discovered_months` (skip if already `done=1`).

**Download phase:**
For each undone month page, issue **one** `action=parse` HTML request (not one per day — the month page transcludes all ~30 days). Parse the rendered HTML to extract each day's:
- Quote text
- Author display name
- Author link `href` (e.g. `/wiki/Albert_Einstein`) → store as full URL
- QOTD day-archive URL (used as `items.url` natural key)

Insert into `discovered_quotes`, mark the month `done=1`. Write all extracted rows into `quotes` from `discovered_quotes`.

All requests are serial through the shared mediawiki client (`maxlag`, backoff, gzip, UA). No fan-out to individual day pages.

---

### 6. Add `download-quotes` script to `package.json`

Add one entry to the `scripts` block in `package.json`:

```json
"download-quotes": "tsx --env-file=scripts/.env scripts/datasets/download-quotes.ts"
```

---

### 7. Add `import_quotes_dataset` to `src/lib/import-datasets.ts` and wire into `src/instrumentation.ts`

In `src/lib/import-datasets.ts`, add `import_quotes_dataset(filename: string)` mirroring `import_pictures_dataset`:

1. `ATTACH DATABASE … AS ref`
2. `INSERT OR IGNORE INTO items (type, title, url) SELECT 'quote', text, url FROM ref.quotes`
3. `INSERT OR IGNORE INTO quotes (item_id, author, author_url) SELECT i.id, q.author, q.author_url FROM ref.quotes q JOIN items i ON i.url = q.url`
4. One fixed `INSERT OR IGNORE INTO item_topics (item_id, dataset, topic) SELECT i.id, 'Quotes', 'Quote of the Day' FROM items i WHERE i.type = 'quote'` (for newly inserted items)
5. `INSERT OR REPLACE INTO datasets (name, source_url) SELECT 'Quotes', value FROM ref.metadata WHERE key = 'source_url'`
6. `DETACH ref`

In `src/instrumentation.ts`, add a `import_quotes_dataset('quotes.db')` call inside its own try/catch block, alongside the existing picture dataset loop.

---

### 8. Create `src/lib/db/quotes.ts` and export from `src/lib/db/index.ts`

Mirror `src/lib/db/pictures.ts`. Implement:

- `row_to_quote(row)` — maps a null-prototype DB row to a plain `Quote` object.
- `fetch_quotes_by_ids(ids: number[], user_id: number | null): Map<number, Quote>` — `SELECT i.id, i.title, i.url, q.author, q.author_url, COALESCE(ui.like, 0) FROM items i JOIN quotes q ON q.item_id = i.id LEFT JOIN user_items ui ON ui.item_id = i.id AND ui.user_id = $user_id WHERE i.id IN (…)`. Attach topics via the existing `fetch_topics_for_items`. Returns a `Map<id, Quote>`.
- `get_voted_quotes(vote: -1 | 1, user_id: number): Quote[]` — mirrors `get_voted_pictures`.

Export `fetch_quotes_by_ids` and `get_voted_quotes` from `src/lib/db/index.ts`.

---

### 9. Generalize `FEED_PICTURE_RATIO` to `FEED_TYPE_SHARES` in `src/lib/db/feed.ts`

This is the most complex change in the feed layer.

**Env var:** Parse `FEED_TYPE_SHARES` at module load (consistent with how `AFFINITY_STRENGTH`/`CLAMP` are already read). Default: `{ article: 0.8, picture: 0.1, quote: 0.1 }`. Shares are relative — expected fraction = share ÷ Σshares. A type with share `0` or absent is hard-excluded.

**SQL changes (built at load time, interpolated into the query string):**
- Replace the current `WHERE p.type IN ('article','picture')` clause with a dynamic `WHERE p.type IN (<included types>)` built from keys with share > 0.
- Replace the binary `CASE p.type WHEN 'picture' THEN $ratio ELSE 1-$ratio END` weight expression with:
  ```sql
  CASE p.type WHEN 'article' THEN 0.8 WHEN 'picture' THEN 0.1 WHEN 'quote' THEN 0.1 ELSE 0 END
  ```
  (values interpolated from parsed shares, not a bind param).
- Drop the `$ratio` bind parameter entirely.

---

### 10. Add quote payload branch to `src/lib/db/feed.ts`

After the `FEED_TYPE_SHARES` refactor, extend the feed result reassembly:

- Collect `quote_ids` from result rows where `type === 'quote'`.
- Call `fetch_quotes_by_ids(quote_ids, user_id)`.
- Replace the binary `r.type === 'article' ? articles.get(r.id) : pictures.get(r.id)` expression with a switch over three Maps: `article` → `articles`, `picture` → `pictures`, `quote` → `quotes`.
- Widen the result-row type union to include `'quote'`.

---

### 11. Widen type unions in `src/lib/db/votes.ts` and `src/app/actions.ts`

**`src/lib/db/votes.ts`:** Widen the `item_type` union in `record_click` to include `'quote'`. `set_like` is already type-agnostic — no change.

**`src/app/actions.ts`:**
- Widen the `type` param of `set_article_like` to include `'quote'`.
- Widen the `type` param of `record_link_click` to include `'quote'`.
- In `get_voted_wiki_articles`, add `get_voted_quotes(vote, uid)` to the merged and returned result array.

---

### 12. Create `src/components/QuoteCard.tsx`

Mirror `src/components/PictureCard.tsx`.

- Primary element: the quote text as a link to `quote.url`, tracked as `'title'`.
- Secondary element: `"— {author}"` linking to `quote.author_url` (tracked as `'by'`, the same credit pattern PictureCard uses).
- Vote buttons (like/dislike), same as other cards.
- `<CardTags topics={quote.topics} onTrack={track} />`.
- `data-card-type="quote"` on the root element.

`LinkType` already includes `'title'` and `'by'` — no changes to shared types needed.

---

### 13. Extend `RandomFeed.tsx` and `VotedFeed.tsx` to dispatch `QuoteCard`

**`src/components/RandomFeed.tsx`:** Replace the binary `.type` ternary (`type === 'article' ? <ArticleCard> : <PictureCard>`) with a three-way dispatch adding `QuoteCard` for `type === 'quote'`.

**`src/components/VotedFeed.tsx`:** Same three-way dispatch. Also widen the `onVoteChange` callback's `type` param union to include `'quote'`.

---

### 14. Add `insert_quote` test helper and `tests/lib/db/quotes.test.ts`

**`tests/helpers/test-db.ts`:** Add `insert_quote(db, { text, url, author, author_url })` mirroring `insert_picture` — inserts into `items` (type `'quote'`), `quotes`, and `item_topics` with the fixed `('Quotes', 'Quote of the Day')` entry. Returns the new `items.id`.

**`tests/lib/db/quotes.test.ts`** (new file, mirrors `pictures.test.ts`):
- `fetch_quotes_by_ids` returns correct fields for unseen and seen quotes.
- Voting (like/dislike) affects `user_items` and is reflected in fetched rows.
- Topics attach correctly.
- Quote items appear in the feed when `FEED_TYPE_SHARES` includes `quote`.
- Quote items are excluded from the feed when `FEED_TYPE_SHARES` has `quote: 0`.

---

### 15. Update ratio-related tests for `FEED_TYPE_SHARES` and bump `migrate.test.ts`

**Ratio tests (`tests/lib/db/feed.test.ts` and any affinity/articles/pictures suites):** Every test that sets `FEED_PICTURE_RATIO` to isolate a type now sets `FEED_TYPE_SHARES` instead. Use the existing `jest.resetModules()` pattern. Examples:
- Article-only: `FEED_TYPE_SHARES=article:1`
- Picture-only: `FEED_TYPE_SHARES=picture:1`

**`tests/lib/db/migrate.test.ts`:** Bump expected `user_version` to `6`. Assert the `quotes` table exists after migration.

---

### 16. Update E2e: seed a quote, widen `ClickRow.item_type`, add card screenshot

**`e2e/global-setup.ts`:** Seed at least one quote — insert into `items`, `quotes`, and `item_topics`, mirroring how the setup seeds a picture.

**`e2e/helpers/db.ts`:** Widen `ClickRow.item_type` (currently `'article' | 'picture'`) to also include `'quote'`.

**`e2e/tests/cards.spec.ts`:** Add a quote-card screenshot test — assert a `[data-card-type="quote"]` element renders with expected structure.

---

### 17. Update docs: `CLAUDE.md`, `README.md`, `.env.example`

**`CLAUDE.md`:**
- Add `quotes.db` to the datasets list and pipeline table.
- Add `quotes` table to the schema section.
- Add **Quotes** to the topics/datasets section (`dataset='Quotes'`, `topic='Quote of the Day'`).
- In the Feed-selection section and feature-flags table, replace `FEED_PICTURE_RATIO` with `FEED_TYPE_SHARES` (format `article:0.8,picture:0.1,quote:0.1`).
- Extend the pictures-vs-articles table and the "switch on `.type`" note to cover three types.

**`README.md`:** Update the `FEED_PICTURE_RATIO` mention to `FEED_TYPE_SHARES`.

**`.env.example`:** Replace the `FEED_PICTURE_RATIO` example line with `FEED_TYPE_SHARES=article:0.8,picture:0.1,quote:0.1`.

---

## Review 1 fixes

- [x] R1-1. Fix e2e scroll-position regression caused by quote cards [haiku]

---

## Review 1 fix Details

### R1-1. Fix e2e scroll-position regression caused by quote cards

**File:** `e2e/tests/feed.spec.ts:37`

The `Home Feed › preserves items and scroll position when switching views and back` test sets `scrollTop = 300`, switches views (liked → random), then asserts scroll is restored to ~300. With quote cards in the fixture (shorter than article/picture cards — no image), browser scroll anchoring adjusts `scrollTop` upward to compensate for height differences, landing at 462 instead of 300.

Fix by adding `overflow-anchor: none` to the feed scroll container in `src/components/RandomFeed.tsx` (the scrollable element). This disables the browser's scroll anchoring so the explicitly restored `scrollTop` value is not adjusted after the DOM re-renders.

If the CSS approach does not fully resolve it, an alternative is to assert the scroll position is within a wider tolerance band in the test itself, or to force a scroll-restore after a short `waitFor` settling period in the test.
