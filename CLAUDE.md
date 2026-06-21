# Code Style

Prefer snake_case unless it's awkward to mix with camelCase.
Prefer const arrow functions over `function`.
Always use curly braces for if/else/loop blocks, even if there is only a single statement.
Don't use one-letter variable names, be more clear.

After type-check passes, always run `npm run check-fix` — it applies Prettier (configured in `package.json`, enforced through `eslint-plugin-prettier`) and fixes lint.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

# Tech stack

- **Next.js 16.2.9** (App Router) + **React 19.2.7**. Output mode `standalone`; deployed to a Raspberry Pi via `scripts/deploy.ts`.
- **MUI v9** (`@mui/material`) for all UI — styling is the `sx` prop only. **No Tailwind, no CSS modules** in components. Theme and light/dark color schemes live in `src/components/App.tsx`.
- **`node:sqlite` `DatabaseSync`** for all data access — no ORM (see SQLite section).
- **TypeScript strict.** Path alias `@/*` → `src/*`.
- Download/build scripts run under **`tsx`**.
- Tests: **Jest** (unit) + **Playwright** (e2e).

# Commands

**Dev / build**

`dev` / `build` / `start` are standard `next` scripts. The rest:

| Command | What it does |
|---|---|
| `npm run check` | Type-check + lint (`tsc --noEmit && eslint`) |
| `npm run check-fix` | Type-check + lint-fix / autoformat (`tsc --noEmit && eslint --fix`) |
| `download-*` | Download datasets | 
| `categorize` | Categorize datasets |
| `npm test` | Jest unit tests (`test:watch`, `test:coverage` also available) |
| `npm run test:e2e:setup` | One-time: install Playwright's chromium |
| `npm run test:e2e` | Run Playwright e2e (seeds the fixture DB automatically) |
| `npm run test:e2e:update` | Update visual snapshots |
| `npm run test:e2e:ui` | Playwright interactive UI |
| `test:e2e:reset-db` | removes the e2e fixture db |
| `deploy:test|prod`  | Deploy|
| `pi:logs:test|prod` | Read logs|
| `pi:funnel`         | Turn on tailscale funnel|
| `pi:down:test|prod` | Shut down instance|

# Architecture

## Runtime DB + prepared reference DBs

`SCROLLSURF_DATA_DIR` is the root holding `scrollsurf.db` and the `datasets/` folder.

- `scrollsurf.db` — runtime database. Holds articles, pictures, user votes/clicks, categories, and topic classifications. This is the only DB the app reads from.
- Reference databases — stored in `datasets/` and built offline by their own download scripts. New ones are added by following this same pattern (download script → `datasets/<name>.db` → importer):
  - `datasets/vital_50000.db` — Wikipedia Level 5 vital articles. Built by `npm run download-vital-50000`.
  - `datasets/unusual.db` — articles from [Wikipedia:Unusual articles](https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles), sections up to and including Military. Built by `npm run download-unusual`.
  - `datasets/good_articles.db` — [Wikipedia Good articles](https://en.wikipedia.org/wiki/Wikipedia:Good_articles). Built by `npm run download-good-articles`.
  - `datasets/featured_articles.db` — [Wikipedia Featured articles](https://en.wikipedia.org/wiki/Wikipedia:Featured_articles). Built by `npm run download-featured-articles`.
  - `datasets/featured_pictures.db` — [Wikipedia Featured pictures](https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures). Built by `npm run download-featured-pictures`. **Uses the picture schema** (`pictures`/`picture_topics`) — not the article schema.
  - `datasets/commons_featured_pictures.db` — [Wikimedia Commons Featured pictures](https://commons.wikimedia.org/wiki/Commons:Featured_pictures). Built by `npm run download-commons-featured-pictures`. Also the picture schema.
  - `datasets/quotes.db` — [Wikiquote Quote of the Day](https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month) entries. Built by `npm run download-quotes`. **Uses the quote schema** (`quotes`/`quote_topics`) — not the article schema.
  - `datasets/categories.db` — Wikipedia category hierarchy mapped to top-level categories. Built by `npm run categorize`.

On startup, `src/instrumentation.ts` (`register`, Node runtime only) calls `init_db()`, then imports the available datasets from `datasets/` into `scrollsurf.db` via SQLite `ATTACH` + bulk `INSERT OR IGNORE` (`src/lib/import-datasets.ts`), then runs `cleanup_inactive_users()`. Picture datasets go through `import_pictures_dataset`, article datasets through `import_articles_dataset`, quotes through `import_quotes_dataset`, categories through `import_categories`. Each import is wrapped in try/catch — a missing or broken reference DB just warns and is skipped.

## Data pipeline

```
npm run download-* → datasets/<name>.db → instrumentation.ts (on startup) → scrollsurf.db → server actions → UI
```

Each download script ends by fetching item **content** (extract/caption, description, image, categories) in batches, then storing it in its reference DB. They differ only in how they discover URLs first (vital uses the quality-class category API; unusual extracts the bold-wrapped `'''[[…]]'''` links from the section subpages; etc.). Shared helpers live in `scripts/lib/`:

- `dataset.ts` / `pictures-dataset.ts` / `quotes-dataset.ts` — the three-phase discover→batch-download orchestration for articles, pictures, and quotes.
- `wiki.ts` / `commons.ts` / `wikiquote.ts` — Wikipedia, Wikimedia Commons, and Wikiquote API clients.
- `mediawiki.ts` — the shared serial MediaWiki client (serial pacing, `maxlag`, exponential backoff, gzip) — where API etiquette is enforced.

All download scripts are resumable: already-downloaded items are skipped. **Datasets are download-once, no backfill** — if a download bug ships bad data, fix the bug, delete the reference DB, and redownload; never add repair/migration machinery to the pipeline.

## SQLite & the `src/lib/db/` layer

Uses Node.js built-in `DatabaseSync` from `node:sqlite` — not better-sqlite3, not Drizzle, no ORM. The connection (`src/lib/db/connection.ts`) opens with `PRAGMA journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`, then runs migrations.

`src/lib/db/` is a directory of focused modules (re-exported from `index.ts`), split by responsibility: `connection.ts` (pragmas, `init_db`/`get_db`), `migrate.ts`/`migrations.ts`, `articles.ts`/`pictures.ts`, `feed.ts`, `affinity.ts`, `topics.ts`, `votes.ts`, `users.ts`, `types.ts`.

**All queries are hand-written prepared statements, prepared per call.** Do **not** reintroduce module-level statement caches (e.g. a `let stmts` holding prepared statements) — that pattern was removed deliberately.

**Null-prototype gotcha:** `DatabaseSync` `.all()` returns rows with null prototypes. Always map results to plain object literals (`row_to_article` / `row_to_picture`) before returning from server actions — raw rows cannot be serialized by Next.js for client components.

## Migrations

Schema changes are an **append-only** list in `src/lib/db/migrations.ts`, tracked by the `user_version` PRAGMA and applied in order by `migrate.ts` on connection open (the runner owns the transaction; there's a downgrade guard). **Never edit or reorder a shipped migration — append a new one.** No `BEGIN/COMMIT` and no non-transactional PRAGMAs inside a migration's `up`.

## Schema (runtime `scrollsurf.db`)

- Content: `items` (unified supertype), `articles`, `pictures`, `quotes`, `item_topics`, `item_categories`, `categories`.
- Metadata: `datasets`, `category_hierarchy`.
- Users (STRICT tables): `users`, `user_items` (`like` −1/0/1), `user_clicks` (append-only engagement log).
- `feed_items` — a VIEW unifying articles + pictures + quotes at the identity level (`type, id`) for feed selection.

(Columns are authoritative in `src/lib/db/migrations.ts`.)

## Topics

`article_topics` / `picture_topics` are `(item_id, dataset, topic)`. Topics are grouped two levels: **dataset → topic**. The `dataset` is set at import time (each importer hardcodes its own); reference DBs store only bare topic names, never the dataset. Current datasets:

- **Vital** — sublists from Wikipedia's Level 5 vital articles (People, Geography, Arts, …).
- **Unusual** — each article's section heading from `Wikipedia:Unusual articles` (Military, Science, Folklore, …).
- **Good** — topics from Wikipedia Good articles page sections.
- **Featured** — topics from Wikipedia Featured articles page sections.
- **Pictures** — gallery section headings from `Wikipedia:Featured pictures`.
- **Commons** — section headings from `Commons:Featured pictures`.
- **Quotes** — one topic `'Quote of the Day'` per quote from Wikiquote QOTD entries.

The dataset grouping is why topic names may safely collide across datasets (multiple datasets can have a History/Technology). An item may have several topics. Per-dataset `source_url` lives in each reference DB's `metadata` key/value table and is copied into `scrollsurf.db`'s `datasets` table on import, so each card's dataset chip can link to its source page.

## Categories

Article categories are mapped to 34 Wikipedia top-level categories (Society, Geography, History, Arts, Medicine, …) via `category_hierarchy (category_name, top_level)`. `npm run categorize` creates `categories.db`. On startup `import_categories()` (`src/lib/import-datasets.ts`) bulk-imports the mapping.

**Do not attempt top-down BFS from top-level categories** — the Wikipedia category graph fans out exponentially (depth 3 ≈ 900K nodes, depth 4 ≈ 27M), making it completely impractical. The walk-up approach is the only viable API-based option. The script is resumable and respects API etiquette. 

## Items: articles, pictures, quotes

All three types use **fully separate schemas** end-to-end:

| Concern | Articles | Pictures | Quotes |
|---|---|---|---|
| Reference DB schema | `articles`, `article_topics`, `article_categories` | `pictures`, `picture_topics` | `quotes` (no categories) |
| Runtime detail table | `articles` | `pictures` | `quotes` |
| Importer | `import_articles_dataset` | `import_pictures_dataset` | `import_quotes_dataset` |
| Download pipeline | `scripts/lib/dataset.ts` / `DiscoveredArticle` | `scripts/lib/pictures-dataset.ts` / `DiscoveredPicture` | `scripts/lib/quotes-dataset.ts` / fixed topics at import |
| TS type | `Article` (`type: 'article'`) | `Picture` (`type: 'picture'`) | `Quote` (`type: 'quote'`) |

The feed returns `FeedItem = Article | Picture | Quote`. The `feed_items` view unifies all three only at the identity level (`type, id`) for selection; the fully-separate payload schemas remain end-to-end — payload columns are fetched per-type after selection. **Always switch on `.type` when handling feed items.**

## Feed selection

`get_next_feed` (`src/lib/db/feed.ts`) issues a single Efraimidis–Spirakis weighted draw over the `feed_items` view, assembled from `feed_affinity_ctes()` + `weighted_random_order_by()` in `src/lib/db/affinity.ts`. It selects unseen items. Weight per item:

```
weight = exp(AFFINITY_STRENGTH · clamped_affinity) · type_share / pool_size
```

- `type_share` is the per-type share from the fixed `TYPE_SHARES` map in `feed.ts`, and `pool_size` is the count of eligible items of that type — so the expected fraction of each type equals its share ÷ Σshares, independent of actual pool sizes. A type with share 0 or absent from the map is hard-excluded (via `WHERE`).
- Per-item affinity is the **average** of its topics' affinities. Per-topic affinity is `(W_LIKE·likes + W_CLICK·clicks − W_DISLIKE·dislikes) / (seen + AFFINITY_SMOOTHING)`, normalized by exposure (smoothing prevents extreme scores on small samples), then clamped to ±`AFFINITY_CLAMP`. Dislikes downweight topics but never hard-exclude items.

Neutral users and anonymous users (`$user_id` is NULL → empty affinity CTEs → affinity 0 everywhere) reduce to exactly uniform random through the same query — a strict generalization. **Do not add hard exclusions or deterministic secondary sorts.**

## Users, cookies & consent

- **Anonymous** users get a random feed but cannot vote or track clicks.
- **Identity** is the `ss_uid` cookie (httpOnly, sameSite lax, a UUID set on consent grant), which drives `get_or_create_user`. Inactivity cleanup after `USER_INACTIVITY_DAYS` (default 14) runs as `cleanup_inactive_users` on startup; the cookie Max-Age matches. Constants in `src/lib/cookie.ts`; lookup in `src/lib/user.ts` (`current_user_id`).
- **Consent** is recorded in the client-readable `ss_consent` cookie. `src/components/CookieConsent.tsx` provides `ConsentContext` (`granted | denied | unknown`). **Voting and link-click tracking are consent-gated** — without `granted` consent the client fires no server request and opens the consent dialog instead.

## Server actions & UI

All client↔DB traffic goes through server actions in `src/app/actions.ts` (no REST routes). Each resolves the user via `current_user_id()` and returns plain-object-mapped rows:

- `get_next_wiki_articles(count)` → `get_next_feed`
- `vote_feed_item(id, value)` → `save_vote`
- `record_link_click(type, id, link_type, label)` → `record_click`
- `get_voted_wiki_articles(vote)` — merged liked/disliked articles + pictures
- `get_wiki_category_tree()` — dev-only (returns `[]` otherwise)
- `grant_consent()` / `revoke_consent()` — manage the consent + `ss_uid` cookies

Component map (all client components except the root layout/page): `App` (theme + consent providers) → `WikiArticles` (view switch: random / liked / disliked / categories) → `RandomFeed` (infinite scroll via `react-intersection-observer`, page size 10), `VotedFeed`, `CategoryFeed` (dev-only). Cards `ArticleCard` / `PictureCard` are chosen by `.type` and share `CardTags` (topic / category / dataset chips, click-tracked).

## Feature flags (env vars)

| Flag | Default | Effect |
|---|---|---|
| `SCROLLSURF_DATA_DIR` | (required) | Root dir for `scrollsurf.db` + `datasets/` |
| `WIKIPEDIA_USER_AGENT` | (required for downloads) | App name, version, contact email for the MediaWiki client |
| `USER_INACTIVITY_DAYS=N` | `14` | Days of inactivity before a user is cleaned up / cookie expires |
| `COMMIT_ID` | `dev` | Surfaced to the client as `NEXT_PUBLIC_COMMIT_ID` |

## Wikipedia API etiquette

> [!IMPORTANT]
> **Every** MediaWiki call (Wikipedia, Wikiquote, Wikimedia Commons) MUST go through `create_mediawiki_api` from `scripts/lib/mediawiki.ts`. This includes throwaway probe / smoke / one-off debugging scripts — **no exceptions, never raw `fetch` against `api.php`.** Raw `fetch` bypasses all etiquette and gets rate-limited (the API returns non-JSON "You are making too many requests" pages). In any `scripts/` file: `import { create_mediawiki_api } from './lib/mediawiki'` (or `'../lib/mediawiki'`) and run with `tsx --env-file=scripts/.env` so `WIKIPEDIA_USER_AGENT` is set (the client throws without it).

All etiquette is enforced in `scripts/lib/mediawiki.ts` per [API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette) and the [Wikimedia API Usage Guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines) — serial requests only (batch titles with `|`), descriptive `User-Agent`, `maxlag`, backoff on `429`/`503`, gzip, `format=json`, no re-fetching cached data. Route all MediaWiki calls through it; don't bypass it.

## Testing

- **Unit (Jest)** — `jest.config.ts`, node environment, coverage over `src/lib/db/*`, `src/lib/user.ts`, `src/app/actions.ts`. Tests live in `tests/` (helpers in `tests/helpers/`).
- **E2e (Playwright)** — `playwright.config.ts`, runs a dev server on **port 3100** and the db at `e2e/.data/` (seeded by `e2e/global-setup.ts`). Mobile-chromium viewport; images are mocked and external navigation stubbed for stable visual snapshots.
