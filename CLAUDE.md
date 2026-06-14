# Code Style
Prefer snake_case unless it's awkward to mix with camelCase.
Prefer const arrow functions over `function`.
Always use curly braces for if/else/loop blocks, even if there is only a single statement.
Don't use one-letter variable names, be more clear.

After type-check passes, always run `npm run lint-fix` to format and fix code automatically.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Architecture

## Runtime DB + prepared reference DBs

- `scrollsurf.db` — runtime database. Holds articles, user votes, categories, and topic classifications. This is the only DB the app reads from.
- Reference databases — stored in `datasets/` and built offline by their own download scripts. New ones are added by following this same pattern (download script → `datasets/<name>.db` → `import-<name>.ts`):
  - `datasets/vital_50000.db` — Wikipedia Level 5 vital articles. Built by `npm run download-vital-50000`.
  - `datasets/unusual.db` — articles from [Wikipedia:Unusual articles](https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles), sections up to and including Military. Built by `npm run download-unusual`.
  - `datasets/good_articles.db` — [Wikipedia Good articles](https://en.wikipedia.org/wiki/Wikipedia:Good_articles). Built by `npm run download-good-articles`.
  - `datasets/featured_articles.db` — [Wikipedia Featured articles](https://en.wikipedia.org/wiki/Wikipedia:Featured_articles). Built by `npm run download-featured-articles`.
  - `datasets/featured_pictures.db` — [Wikipedia Featured pictures](https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures). Built by `npm run download-featured-pictures`. **Uses a separate schema** (`pictures`/`picture_topics`) — not the article schema. Import is handled by `import_pictures_dataset`, not `import_articles_dataset`.
  - `datasets/categories.db` — Wikipedia category hierarchy mapped to top-level categories. Built by `npm run categorize`.

On startup, `src/instrumentation.ts` discovers and imports available datasets from `datasets/` into `scrollsurf.db` via SQLite `ATTACH` + bulk `INSERT OR IGNORE`.

## SQLite

Uses Node.js built-in `DatabaseSync` from `node:sqlite` — not better-sqlite3, not Drizzle, no ORM. All queries are hand-written prepared statements in `src/lib/db.ts`.

**Important:** `DatabaseSync` `.all()` returns rows with null prototypes. Always map results to plain object literals before returning from server actions — raw rows cannot be serialized by Next.js for client components.

## Data pipeline

```
npm run download-* → datasets/<name>.db → instrumentation.ts (on startup) → scrollsurf.db → server actions → UI
```

Each download script ends by fetching article **content** (extract, description, image, categories) in batches, then storing it in its reference DB. They differ only in how they discover article URLs first:

- **download-vital-50000** — fetches titles from Wikipedia's quality-class category API (FA-Class, GA-Class, etc.).
- **download-unusual** — reads the section subpages transcluded by `Wikipedia:Unusual articles` (in page order, up to and including Military) and extracts the bold-wrapped `'''[[…]]'''` links listed in each.

All download scripts are resumable: already-downloaded articles are skipped.

## Topics

`article_topics` (in `scrollsurf.db`) is `(article_id, dataset, topic)`. Topics are grouped two levels: **dataset → topic**. The `dataset` is set at import time (each importer hardcodes its own); reference DBs store only bare topic names, never the dataset. Current datasets:

- **Vital** — sublists from Wikipedia's Level 5 vital articles: People, Geography, Arts, etc. (`datasets/vital_50000.db`'s `article_vital_topics`).
- **Unusual** — each article's section heading from `Wikipedia:Unusual articles`: Military, Science, Folklore, etc. (`datasets/unusual.db`'s `article_topics`).
- **Good** — topics from Wikipedia Good articles page sections.
- **Featured** — topics from Wikipedia Featured articles page sections.
- **Pictures** — gallery section headings from `Wikipedia:Featured pictures` subpages: Animals, Artwork, Space, etc. (`datasets/featured_pictures.db`'s `picture_topics`). Stored in the runtime `picture_topics` table, not `article_topics`.

The dataset grouping is why topic names may safely collide across datasets (both Vital and Unusual have a History/Technology). An article may have several topics. Datasets are not user-selectable — every user gets all of them; the feed only requires that an item has at least one topic row.

Per-dataset metadata (currently just `source_url`, the Wikipedia page the dataset comes from) lives in each reference DB's `metadata` key/value table. On import it's copied into `scrollsurf.db`'s `datasets (name, source_url)` table, which the article queries join so each card's dataset chip can link to its source page.

## Categories

Article categories are mapped to 34 Wikipedia top-level categories (Society, Geography, History, Arts, Medicine, etc.) via `category_hierarchy (category_name, top_level)`. Build the mapping offline with `npm run categorize`, which creates `categories.db`:

1. **Bootstrap** — fetches direct children of each top-level from Wikipedia (~2 mins, one-time).
2. **Categorize** — walks up the Wikipedia category DAG incrementally for unmapped categories, storing the mapping.

**Do not attempt top-down BFS from top-level categories** — the Wikipedia category graph fans out exponentially (depth 3 ≈ 900K nodes, depth 4 ≈ 27M) making it completely impractical. The walk-up approach is the only viable API-based option, though slow (~30–90 hours for all dataset categories).

On startup, `src/instrumentation.ts` imports the category hierarchy from `categories.db` into `scrollsurf.db` via SQLite `ATTACH` + bulk `INSERT OR IGNORE` (`src/lib/import-categories.ts`). The script is resumable and respects Wikipedia API etiquette.

## Pictures vs articles

Pictures and articles use **fully separate schemas** end-to-end:

| Concern | Articles | Pictures |
|---|---|---|
| Reference DB schema | `articles`, `article_topics`, `article_categories` | `pictures`, `picture_topics` |
| Runtime tables | `articles`, `user_articles`, `article_topics` | `pictures`, `user_pictures`, `picture_topics` |
| Importer | `import_articles_dataset` | `import_pictures_dataset` |
| Download pipeline | `scripts/lib/dataset.ts` / `DiscoveredArticle` | `scripts/lib/pictures-dataset.ts` / `DiscoveredPicture` |
| TS type | `Article` (`type: 'article'`) | `Picture` (`type: 'picture'`) |

The feed returns `FeedItem = Article | Picture`. Always switch on `.type` when handling feed items.

A `feed_items` SQL view unifies the two item tables at the identity level (`type, id`) for feed selection. The fully-separate payload schemas remain end-to-end — payload columns are fetched per-type after selection.

## Feature flags (env vars)

| Flag | Default | Effect |
|---|---|---|
| `DOWNLOAD_LIMIT=N` | unlimited | Caps articles downloaded per `npm run download-vital-50000` run |
| `FEED_PICTURE_RATIO=N` | `0.1` | Per-type weight multiplier in the unified SQL draw (expected picture fraction: 0–1); `0` → zero pictures, `1` → zero articles |
| `FEED_AFFINITY_STRENGTH=N` | `2.0` | Strength of topic-affinity feed weighting; `0` = pure random |

## Wikipedia API etiquette

Per [API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette) and [Wikimedia API Usage Guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines):

- **Serial requests only** — no concurrent connections; batch multiple titles with `|` instead
- **User-Agent** — must include app name, version, and contact email; never impersonate a browser
- **`maxlag` parameter** — always set on non-interactive requests to respect server load
- **Respect rate limits** — back off with exponential delay on `429`/`503`; never mask high usage via multiple user agents
- **Cache results** — never re-fetch data you already have
- **GZip** — send `Accept-Encoding: gzip` on all requests
- **JSON** — use `format=json` for all requests

## Feed selection

`get_next_feed` issues a single Efraimidis–Spirakis weighted draw over a unified `feed_items` view. The query joins both `articles` and `pictures` at the identity level (`type, id`) and selects unseen items with at least one topic. Weight is calculated per-item as:

```
weight = exp(AFFINITY_STRENGTH · affinity) · type_share / pool_size
```

where `type_share` is `FEED_PICTURE_RATIO` for pictures and `1 - FEED_PICTURE_RATIO` for articles, and `pool_size` is the count of eligible items of that type. This ensures the expected picture fraction equals the ratio, independent of pool sizes. `FEED_PICTURE_RATIO=0` hard-excludes pictures (via `WHERE`); `FEED_PICTURE_RATIO=1` hard-excludes articles.

Topic affinity is derived from the user's likes, dislikes, and link clicks on seen items, normalized by exposure (smoothing constant 5). Neutral users, anonymous users, and `FEED_AFFINITY_STRENGTH=0` all reduce to exactly uniform random — strict generalization of the previous behavior. Dislikes downweight topics but never hard-exclude items. Constants live in `src/lib/db/affinity.ts`. Do not add hard exclusions or deterministic secondary sorts.
