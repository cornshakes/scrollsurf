# Code Style
Prefer snake_case unless it's awkward to mix with camelCase.
Prefer const arrow functions over `function`.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Architecture

## Runtime DB + prepared reference DBs

- `scrollsurf.db` — runtime database. Holds articles, user votes, categories, and topic classifications. This is the only DB the app reads from.
- Reference databases — each is built offline by its own download script and never touched by the app directly. New ones are added by following this same pattern (download script → `<name>.db` → `import-<name>.ts`):
  - `vital_50000.db` — Wikipedia Level 5 vital articles. Built by `npm run download-vital-50000`.
  - `unusual.db` — articles from [Wikipedia:Unusual articles](https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles), sections up to and including Military. Built by `npm run download-unusual`.

On startup, `src/instrumentation.ts` imports new articles from each reference DB into `scrollsurf.db` via SQLite `ATTACH` + bulk `INSERT OR IGNORE` (`src/lib/import-vital.ts`, `src/lib/import-unusual.ts`).

## SQLite

Uses Node.js built-in `DatabaseSync` from `node:sqlite` — not better-sqlite3, not Drizzle, no ORM. All queries are hand-written prepared statements in `src/lib/db.ts`.

**Important:** `DatabaseSync` `.all()` returns rows with null prototypes. Always map results to plain object literals before returning from server actions — raw rows cannot be serialized by Next.js for client components.

## Data pipeline

```
npm run download-* → <name>.db → instrumentation.ts (on startup) → scrollsurf.db → server actions → UI
```

Each download script ends by fetching article **content** (extract, description, image, categories) in batches, then storing it in its reference DB. They differ only in how they discover article URLs first:

- **download-vital-50000** — fetches titles from Wikipedia's quality-class category API (FA-Class, GA-Class, etc.).
- **download-unusual** — reads the section subpages transcluded by `Wikipedia:Unusual articles` (in page order, up to and including Military) and extracts the bold-wrapped `'''[[…]]'''` links listed in each.

All download scripts are resumable: already-downloaded articles are skipped.

## Topics

`article_topics` (in `scrollsurf.db`) is `(article_id, dataset, topic)`. Topics are grouped two levels: **dataset → topic**. The `dataset` is set at import time (each importer hardcodes its own); reference DBs store only bare topic names, never the dataset. Current datasets:

- **Vital** — sublists from Wikipedia's Level 5 vital articles: People, Geography, Arts, etc. (`vital_50000.db`'s `article_vital_topics`).
- **Unusual** — each article's section heading from `Wikipedia:Unusual articles`: Military, Science, Folklore, etc. (`unusual.db`'s `article_topics`).

The dataset grouping is why topic names may safely collide across datasets (both Vital and Unusual have a History/Technology). An article may have several topics; the topics page (`get_topic_tree`) returns a `DatasetGroup[]` and the UI nests topics under their dataset.

## Feature flags (env vars)

| Flag | Default | Effect |
|---|---|---|
| `DOWNLOAD_LIMIT=N` | unlimited | Caps articles downloaded per `npm run download-vital-50000` run |

## Wikipedia API etiquette

Per [API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette) and [Wikimedia API Usage Guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines):

- **Serial requests only** — no concurrent connections; batch multiple titles with `|` instead
- **User-Agent** — must include app name, version, and contact email; never impersonate a browser
- **`maxlag` parameter** — always set on non-interactive requests to respect server load
- **Respect rate limits** — back off with exponential delay on `429`/`503`; never mask high usage via multiple user agents
- **Cache results** — never re-fetch data you already have
- **GZip** — send `Accept-Encoding: gzip` on all requests
- **JSON** — use `format=json` for all requests

## Article selection

`get_next_articles` uses `ORDER BY RANDOM()` — do not add a secondary sort.
