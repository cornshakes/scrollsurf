# Code Style
Prefer snake_case unless it's awkward to mix with camelCase.
Prefer const arrow functions over `function`.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Architecture

## Two databases

- `scrollsurf.db` — runtime database. Holds articles, user votes, categories, and ML topic classifications. This is the only DB the app reads from.
- `vital_50000.db` — download-only reference database. Created and updated by `npm run download-vital-50000`. Never touched by the app directly.

On startup, `src/instrumentation.ts` imports new articles from `vital_50000.db` into `scrollsurf.db` via SQLite `ATTACH` + bulk `INSERT OR IGNORE`.

## SQLite

Uses Node.js built-in `DatabaseSync` from `node:sqlite` — not better-sqlite3, not Drizzle, no ORM. All queries are hand-written prepared statements in `src/lib/db.ts`.

**Important:** `DatabaseSync` `.all()` returns rows with null prototypes. Always map results to plain object literals before returning from server actions — raw rows cannot be serialized by Next.js for client components.

## Data pipeline

```
npm run download-vital-50000 → vital_50000.db → instrumentation.ts (on startup) → scrollsurf.db → server actions → UI
```

The download script runs in two phases:
1. **Download article URLs** — fetches article titles from Wikipedia's category API (FA-Class, GA-Class, etc.)
2. **Download article content** — fetches extract, description, and image for each new URL

Results are stored in `vital_50000.db`. It is resumable: already-downloaded articles are skipped.

## Two topic systems — do not confuse them

- `article_vital_topics` (in `vital_50000.db`) — editorial sublists from Wikipedia's Level 5 vital articles: People, Geography, Arts, etc. Assigned during download.
- `article_topics` (in `scrollsurf.db`) — ML classifications from Wikimedia's LiftWing API. Assigned lazily after articles are seen, only when `SETTLE_TOPICS=1`.

## Feature flags (env vars)

| Flag | Default | Effect |
|---|---|---|
| `DOWNLOAD_LIMIT=N` | unlimited | Caps articles downloaded per `npm run download-vital-50000` run |

## Article selection

`get_next_articles` uses `ORDER BY RANDOM()` — do not add a secondary sort.
