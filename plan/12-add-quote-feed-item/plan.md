# Add Wikiquote QOTD quotes as a third feed type

## Context

The feed currently surfaces two item types — `article` and `picture` — unified under a
global-id supertype (`items` + per-type detail tables) by the work in
[plan/10-unify-feed-items/plan.md](plan/10-unify-feed-items/plan.md). That plan's last
section explicitly anticipates a third type ("quotes") and confirms the hot feed path
(`affinity.ts`, `eligible_pool`, `user_items`, `item_topics`, mark-seen, `set_like`) needs
**no changes** — a new type only adds a detail table + importer + a payload branch + a card.

We want to add **Quote of the Day** entries from
[Wikiquote:QOTD by month](https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month). A card's
title is the **quote text**; a **"— Author"** line links to that person's Wikiquote page.

### What the source provides (verified against the live API)

Each QOTD entry exposes: a date, the quote text, the author name, and a link to the author's
Wikiquote page (`/wiki/Author_Name`). There are **no built-in topics or theme tags** on
quotes. Author-page *categories* are biographical and inconsistent (Einstein → only
"Category:Albert Einstein"; Martin Luther King → none; Maya Angelou → 20 demographic
categories), so they are a poor affinity signal. The article-only 34-top-level category
mapping is dev-only and does not apply to quotes.

### Decisions (confirmed with the user)

1. **Topics: a single "Quotes" topic.** Every quote gets one topic `(dataset='Quotes',
   topic='Quote of the Day')`. This satisfies the feed's "must have ≥1 topic" eligibility
   rule with zero extra API lookups. Affinity then learns whether a user likes quotes *as a
   whole* (not which kinds) — acceptable for v1; richer per-author topics (e.g. Wikidata
   occupation) can be layered on later without schema change.
2. **Feed mix: generalize the binary `FEED_PICTURE_RATIO` to explicit per-type shares.**
   Replace it with `FEED_TYPE_SHARES` so each type's share is configurable and a third type
   has a defined slice.

## Quote data model

A quote's unique natural key (`items.url`) is its **QOTD day-archive page**
(`Wikiquote:Quote of the day/Month D, YYYY`) — permanent and unique per slot. `items.title`
is the quote text. The author page link is stored explicitly (author names carry commas /
disambiguation, so deriving the URL is fragile).

- New type `Quote extends BaseFeedItem { type:'quote'; author: string; author_url: string | null; topics: Topic[] }` in [src/lib/db/types.ts](src/lib/db/types.ts); add to the `FeedItem` union.

## Implementation

### 1. Download pipeline (new reference DB `datasets/quotes.db`)

Mirror the pictures pipeline ([scripts/lib/pictures-dataset.ts](scripts/lib/pictures-dataset.ts),
[scripts/datasets/download-featured-pictures.ts](scripts/datasets/download-featured-pictures.ts)).

- **`scripts/lib/wikiquote.ts`** — `wiki_api = create_mediawiki_api('https://en.wikiquote.org/w/api.php')`, exactly like [scripts/lib/wiki.ts](scripts/lib/wiki.ts#L1-L3) wraps Wikipedia. Routes all calls through the shared etiquette-enforcing client ([scripts/lib/mediawiki.ts](scripts/lib/mediawiki.ts)); reuses `WIKIPEDIA_USER_AGENT`.
- **`scripts/lib/quotes-dataset.ts`** — two-phase discover→download orchestration. Reference schema:
  - `metadata(key PK, value)` — `title='Quotes'`, `source_url='https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month'`.
  - `quotes(text TEXT, url TEXT UNIQUE, author TEXT, author_url TEXT)`.
  - `discovered_quotes(url PK, text, author, author_url)` — extracted rows; plus a small `discovered_months(page PK, done INTEGER DEFAULT 0)` to drive month-granularity resumability (skip months already fetched).
  - No `quote_topics` table — the single fixed topic is applied at import time.
- **`scripts/datasets/download-quotes.ts`** — discovery: fetch the QOTD-by-month index (one request) → enumerate the monthly subpages → for each **month**, issue **one** `action=parse` **HTML** request. The month page already transcludes/renders every day's entry (verified: fetching `…/June 2026` returned the whole month's quotes with text + author + author link in a single page), so we extract all ~30 days' quote text + author display name + author link `href` from it — **not** one request per day. This is ~12 parse requests/year (vs ~365 if parsing day pages), all serial through [scripts/lib/mediawiki.ts](scripts/lib/mediawiki.ts) (`maxlag` + backoff + UA + gzip). `action=parse` cannot batch multiple pages, so parsing the month page is the meaningful way to minimize request count per etiquette. Resumable at **month granularity** (skip months already fully fetched). **Scope the initial download to recent years** (configurable range) to limit older-format variance.
- **`package.json`** — add `"download-quotes": "tsx --env-file=scripts/.env scripts/datasets/download-quotes.ts"`.

### 2. Runtime migration (append-only)

Append the **next** migration version in [src/lib/db/migrations.ts](src/lib/db/migrations.ts)
(currently head is 5 → add **6**; verify the current max before writing). Only one new table —
`items` / `item_topics` / `user_items` are already type-agnostic:

```sql
CREATE TABLE quotes (
  item_id    INTEGER PRIMARY KEY REFERENCES items(id),
  author     TEXT NOT NULL,
  author_url TEXT
);
```

### 3. Importer

In [src/lib/import-datasets.ts](src/lib/import-datasets.ts), add `import_quotes_dataset(filename)`
mirroring `import_pictures_dataset`: `ATTACH`; `INSERT OR IGNORE INTO items (type='quote', title, url)`
from `ref.quotes`; `INSERT OR IGNORE INTO quotes (item_id, author, author_url)` joined on
`items.url = ref.quotes.url`; **one fixed** `INSERT OR IGNORE INTO item_topics (item_id, 'Quotes',
'Quote of the Day')` per quote item; `INSERT OR REPLACE INTO datasets (name='Quotes', source_url)`
from `ref.metadata`; `DETACH`. Wire it into [src/instrumentation.ts](src/instrumentation.ts) (add a
`import_quotes_dataset('quotes.db')` call in its own try/catch, alongside the picture loop).

### 4. DB layer

- **`src/lib/db/quotes.ts`** (new) — mirror [src/lib/db/pictures.ts](src/lib/db/pictures.ts): `row_to_quote`, `fetch_quotes_by_ids(ids, user_id)` (`items i JOIN quotes q ON q.item_id=i.id LEFT JOIN user_items ui …`, select `i.id, i.title, i.url, q.author, q.author_url, COALESCE(ui.like,0)`, attach topics via `fetch_topics_for_items`), and `get_voted_quotes(vote, user_id)`. Export both from [src/lib/db/index.ts](src/lib/db/index.ts).
- **[src/lib/db/feed.ts](src/lib/db/feed.ts)** — two changes:
  - *Generalize the ratio knob.* Replace `PICTURE_RATIO`/`$ratio` with a `FEED_TYPE_SHARES` map parsed at module load (default `{ article: 0.8, picture: 0.1, quote: 0.1 }`; shares are relative — expected fraction = share ÷ Σshares; a type with share 0 or absent is hard-excluded). Build, at load time (consistent with how `AFFINITY_STRENGTH`/`CLAMP` are already interpolated into the SQL string at [feed.ts:28](src/lib/db/feed.ts#L28)): a `WHERE p.type IN (…included types…)` clause and a `CASE p.type WHEN '<type>' THEN <share> … ELSE 0 END` expression replacing the current binary `CASE … $ratio …` term in the `ORDER BY`. Drop the `$ratio` bind param.
  - *Add the quote payload branch.* Widen the result-row type union to include `'quote'`; add `quote_ids` + `fetch_quotes_by_ids`; turn the final reassembly (currently `r.type === 'article' ? articles.get : pictures.get`) into a switch over the three Maps.
- **[src/lib/db/votes.ts](src/lib/db/votes.ts)** — `record_click`'s `item_type` union widens to include `'quote'`. `set_like` is type-agnostic — no change.

### 5. Server actions

In [src/app/actions.ts](src/app/actions.ts): widen the `type` param unions of `set_article_like`
and `record_link_click` to include `'quote'`; in `get_voted_wiki_articles`, add `get_voted_quotes(vote, uid)`
to the merged result.

### 6. UI

- **`src/components/QuoteCard.tsx`** (new) — mirror [src/components/PictureCard.tsx](src/components/PictureCard.tsx): render the quote text as the primary link to `quote.url` (tracked as `'title'`); a **"— {author}"** line linking to `quote.author_url` (tracked as `'by'`, exactly the credit→`'by'` pattern PictureCard uses); vote buttons; `<CardTags topics={quote.topics} onTrack={track} />`. `data-card-type="quote"`. `LinkType` already includes `'title'` and `'by'` — no change.
- **[src/components/RandomFeed.tsx](src/components/RandomFeed.tsx)** & **[src/components/VotedFeed.tsx](src/components/VotedFeed.tsx)** — extend the binary `.type` ternary to a three-way dispatch selecting `QuoteCard`; widen `onVoteChange`'s type param union (VotedFeed) to include `'quote'`.

### 7. Docs

- **[CLAUDE.md](CLAUDE.md)** — add `quotes.db` to the datasets list and pipeline; add the **Quotes** topic/dataset; add the `quotes` table to the schema section; in the Feed-selection section and the feature-flags table, replace `FEED_PICTURE_RATIO` with `FEED_TYPE_SHARES`; extend the pictures-vs-articles table and the "switch on `.type`" note to three types.
- **[README.md](README.md#L139)** and **[.env.example](.env.example#L11)** — update the `FEED_PICTURE_RATIO` mention/example to `FEED_TYPE_SHARES`.
  (Leave `plan/**` historical docs untouched.)

### 8. Tests

- **[tests/helpers/test-db.ts](tests/helpers/test-db.ts)** — add `insert_quote(...)` mirroring `insert_picture` (inserts `items` + `quotes` + `item_topics`, returns `items.id`).
- **`tests/lib/db/quotes.test.ts`** (new) — mirror `pictures.test.ts` (unseen/seen, voting, topics, feed appearance).
- **Ratio-knob migration** — every test that sets `FEED_PICTURE_RATIO` to isolate a type now sets `FEED_TYPE_SHARES` instead (e.g. `article:1` for article-only, `picture:1` for picture-only), via the existing `jest.resetModules()` pattern. Touches at least [tests/lib/db/feed.test.ts](tests/lib/db/feed.test.ts) and the affinity/articles/pictures suites that use it.
- **`migrate.test.ts`** — bump expected `user_version` to 6 and assert the `quotes` table exists.
- **E2e** — [e2e/global-setup.ts](e2e/global-setup.ts): seed at least one quote (items + quotes + item_topics, mirroring its picture seeding); [e2e/helpers/db.ts](e2e/helpers/db.ts#L6): widen `ClickRow.item_type` to include `'quote'`; [e2e/tests/cards.spec.ts](e2e/tests/cards.spec.ts): add a quote-card screenshot test.

## Risks

- **QOTD template-format drift** across 2007→present is the main effort/risk. Parse rendered HTML (not wikitext) and scope the first download to recent years; the pipeline is resumable (month granularity) and download-once ([[datasets-are-download-once-no-backfill]]).
- **API etiquette** — one `action=parse` per month page (each renders the full month), serial through the shared client; do not fan out one request per day. No new etiquette code is needed — route through `mediawiki.ts` like `wiki.ts`/`commons.ts`.
- **Replacing `FEED_PICTURE_RATIO`** is a breaking config change — update every live reference (code, tests, `.env.example`, deploy env, docs). It is *not* in any `plan/**` file we should edit.

## Verification

1. Run the download for a recent range: `npm run download-quotes`; confirm `datasets/quotes.db` has `quotes` rows with text/url/author/author_url.
2. `npm run check`, then `npm run lint-fix`.
3. `npm test` — new `quotes.test.ts` passes; ratio tests pass under `FEED_TYPE_SHARES`; `migrate.test.ts` asserts version 6 + `quotes` table.
4. `npm run dev` (with `quotes.db` present in `SCROLLSURF_DATA_DIR/datasets/`) — quote cards appear in the feed at roughly their configured share; clicking a card's author goes to the Wikiquote person page; like/dislike persists and the liked/disliked views show quotes.
5. `npm run test:e2e` — reseeded fixture includes a quote; quote-card screenshot stable. `npm run test:e2e:update` only if a snapshot genuinely shifts.
