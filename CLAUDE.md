# Code Style

- Prefer snake_case unless it's awkward to mix with camelCase. Use PascalCase
  for types.
- Prefer const arrow functions over `function`.
- Always use curly braces for if/else/loop blocks, even if there is only a
  single statement.
- Don't use one-letter variable names, be clear.

# Development

When in plan mode (ONLY when in plan mode), write the plan to
plans/%nnn_<plan-name>/plan-%n.md. When a plan gets too big, it should be split
into smaller plans that can be implemented and deployed sequentially, e.g. one
plan does the backend, the other ui & e2e screenshot testing. Each plan should
follow this structure:

- context: what is this about, how did we get here (mostly plain english)
- content: what are we going to do (mostly plain english)
- notes: what to watch out for, decisions that have been made (mostly plain
  english)
- implementation: what code changes to make
  - ordered "bottom-up" e.g. first schema, then server, then client, then e2e
  - code examples should be small
  - **each implementation section ends with a list of tests**. All the test
    names (inclduding suites) can be copy-pasted into the bdd style test/spec
    files.

A tasks.md file should be created in the same directory as the plan.

- begins with a TOC - a numbered list of all tasks with checkboxes e.g. "1. Add
  leopards.ts []"
- the list can have sections e.g. "# Plan 2", linking to the corresponding plan
- below there can be sections adding extra information if necessary
- each task should be one easy-to-review commit
- never split implementation and testing. Always add tests with the code.
- if a series of tasks requires its own test suite & wiring, create that first
  (not the whole suite, just the basic files so that each task can add code to
  it).

My workflow: First, create plans. Later plans can stay stubs at first, but we
can already edit them should the opportunity arise. Once the first plan is done,
create the tasks.md file. Then you implement the first task, I review & commit
it, and so on until all the tasks are done. When finishing a task, _first_ run
linting & formatting, _then_ run the tests.

When creating screenshot tests, make them run and generate the screenshots once
but don't try to get them pixel perfect and don't try to fix every little timing
bug. Report them and continue, but don't waste time.

Never run any git commands (except read-only)

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may
all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation
notices.

# Tech stack

- **Next.js 16.2.9** (App Router) + **React 19.2.7**. Output mode `standalone`;
  deployed via `scripts/deploy.ts` — test to a Raspberry Pi, prod to the box.
- **MUI v9** (`@mui/material`) for all UI — styling is the `sx` prop only. **No
  Tailwind, no CSS modules** in components. Theme and light/dark color schemes
  live in `src/components/App.tsx`.
- **`node:sqlite` `DatabaseSync`** for all data access — no ORM (see SQLite
  section).
- **TypeScript strict.** Path alias `@/*` → `src/*`.
- Download/build scripts run under **`tsx`**.
- Tests: **Jest** (unit) + **Playwright** (e2e).

# Commands

**Dev / build**

`dev` / `build` / `start` are standard `next` scripts. The rest:

| Command                   | What it does                                                        |
| ------------------------- | ------------------------------------------------------------------- |
| `npm run check`           | Type-check + lint (`tsc --noEmit && eslint`)                        |
| `npm run check-fix`       | Type-check + lint-fix / autoformat (`tsc --noEmit && eslint --fix`) |
| `download-*`              | Download datasets                                                   |
| `categorize`              | Categorize datasets                                                 |
| `npm test`                | Jest unit tests (`test:watch`, `test:coverage` also available)      |
| `npm run test:e2e:setup`  | One-time: install Playwright's chromium                             |
| `npm run test:e2e`        | Run Playwright e2e (seeds the fixture DB automatically)             |
| `npm run test:e2e:update` | Update visual snapshots                                             |
| `npm run test:e2e:ui`     | Playwright interactive UI                                           |
| `test:e2e:reset-db`       | removes the e2e fixture db                                          |
| `deploy:test              | prod`                                                               |
| `logs:test                | prod`                                                               |
| `down:test                | prod`                                                               |

# Architecture

## Runtime DB + prepared reference DBs

`SCROLLSURF_DATA_DIR` is the root holding `scrollsurf.db` and the `datasets/`
folder.

- `scrollsurf.db` — runtime database. Holds articles, pictures, user
  votes/clicks, categories, and topic classifications. This is the only DB the
  app reads from.
- Reference databases — stored in `datasets/` and built offline by their own
  download scripts. New ones are added by following this same pattern (download
  script → `datasets/<name>.db` → importer):
  - `datasets/vital_50000.db` — Wikipedia Level 5 vital articles. Built by
    `npm run download-vital-50000`.
  - `datasets/unusual.db` — articles from
    [Wikipedia:Unusual articles](https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles),
    sections up to and including Military. Built by `npm run download-unusual`.
  - `datasets/good_articles.db` —
    [Wikipedia Good articles](https://en.wikipedia.org/wiki/Wikipedia:Good_articles).
    Built by `npm run download-good-articles`.
  - `datasets/featured_articles.db` —
    [Wikipedia Featured articles](https://en.wikipedia.org/wiki/Wikipedia:Featured_articles).
    Built by `npm run download-featured-articles`.
  - `datasets/featured_pictures.db` —
    [Wikipedia Featured pictures](https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures).
    Built by `npm run download-featured-pictures`. **Uses the picture schema**
    (`pictures`/`picture_topics`) — not the article schema.
  - `datasets/commons_featured_pictures.db` —
    [Wikimedia Commons Featured pictures](https://commons.wikimedia.org/wiki/Commons:Featured_pictures).
    Built by `npm run download-commons-featured-pictures`. Also the picture
    schema.
  - `datasets/quotes.db` —
    [Wikiquote Quote of the Day](https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month)
    entries. Built by `npm run download-quotes`. **Uses the quote schema**
    (`quotes`/`quote_topics`) — not the article schema.
  - `datasets/categories.db` — Wikipedia category hierarchy mapped to top-level
    categories. Built by `npm run categorize`.

On startup, `src/instrumentation.ts` (`register`, Node runtime only) calls
`init_db()`, then imports the available datasets from `datasets/` into
`scrollsurf.db` via SQLite `ATTACH` + bulk `INSERT OR IGNORE`
(`src/lib/import-datasets.ts`), then runs `rebuild_feed_index()` (not wrapped in
try/catch — a broken feed index must fail startup loudly) and
`cleanup_inactive_users()`. Picture datasets go through
`import_pictures_dataset`, article datasets through `import_articles_dataset`,
quotes through `import_quotes_dataset`, categories through `import_categories`.
Each import is wrapped in try/catch — a missing or broken reference DB just
warns and is skipped.

## Data pipeline

```
npm run download-* → datasets/<name>.db → instrumentation.ts (on startup) → scrollsurf.db → server actions → UI
```

Each download script ends by fetching item **content** (extract/caption,
description, image, categories) in batches, then storing it in its reference DB.
They differ only in how they discover URLs first (vital uses the quality-class
category API; unusual extracts the bold-wrapped `'''[[…]]'''` links from the
section subpages; etc.). Shared helpers live in `scripts/lib/`:

- `dataset.ts` / `pictures-dataset.ts` / `quotes-dataset.ts` — the three-phase
  discover→batch-download orchestration for articles, pictures, and quotes.
- `wiki.ts` / `commons.ts` / `wikiquote.ts` — Wikipedia, Wikimedia Commons, and
  Wikiquote API clients.
- `mediawiki.ts` — the shared serial MediaWiki client (serial pacing, `maxlag`,
  exponential backoff, gzip) — where API etiquette is enforced.

All download scripts are resumable: already-downloaded items are skipped.
**Datasets are download-once, no backfill** — if a download bug ships bad data,
fix the bug, delete the reference DB, and redownload; never add repair/migration
machinery to the pipeline.

## SQLite & the `src/lib/db/` layer

Uses Node.js built-in `DatabaseSync` from `node:sqlite` — not better-sqlite3,
not Drizzle, no ORM. The connection (`src/lib/db/connection.ts`) opens with
`PRAGMA journal_mode = WAL`, `busy_timeout = 5000`, `foreign_keys = ON`, then
runs migrations.

`src/lib/db/` is a directory of focused modules (re-exported from `index.ts`),
split by responsibility: `connection.ts` (pragmas, `init_db`/`get_db`),
`migrate.ts`/`migrations.ts`, `articles.ts`/`pictures.ts`, `feed.ts`,
`feed-index.ts`, `affinity.ts`, `topics.ts`, `votes.ts`, `users.ts`, `types.ts`.

**All queries are hand-written prepared statements, prepared per call.** Do
**not** reintroduce module-level statement caches (e.g. a `let stmts` holding
prepared statements) — that pattern was removed deliberately.

**Null-prototype gotcha:** `DatabaseSync` `.all()` returns rows with null
prototypes. Always map results to plain object literals (`row_to_article` /
`row_to_picture`) before returning from server actions — raw rows cannot be
serialized by Next.js for client components.

## Migrations

Schema changes are an **append-only** list in `src/lib/db/migrations.ts`,
tracked by the `user_version` PRAGMA and applied in order by `migrate.ts` on
connection open (the runner owns the transaction; there's a downgrade guard).
**Never edit or reorder a shipped migration — append a new one.** No
`BEGIN/COMMIT` and no non-transactional PRAGMAs inside a migration's `up`.

## Schema (runtime `scrollsurf.db`)

- Content: `items` (unified supertype), `articles`, `pictures`, `quotes`,
  `item_topics`, `item_categories`, `categories`.
- Metadata: `datasets`, `category_hierarchy`.
- Users (STRICT tables): `users`, `user_items` (`like` −1/0/1), `user_clicks`
  (append-only engagement log).
- Feed index (derived, rebuilt on startup by `rebuild_feed_index()`):
  `bucket_set_items`, `bucket_set_buckets`, `bucket_set_counts` (see Feed
  selection).

(Columns are authoritative in `src/lib/db/migrations.ts`.)

## Topics

`item_topics` is `(item_id, dataset, topic)` (the per-type `article_topics` /
`picture_topics` reference-DB tables are unified into it on import). Topics are
grouped two levels: **dataset → topic**. The `dataset` is set at import time
(each importer hardcodes its own); reference DBs store only bare topic names,
never the dataset. Current datasets:

- **Vital** — sublists from Wikipedia's Level 5 vital articles (People,
  Geography, Arts, …).
- **Unusual** — each article's section heading from `Wikipedia:Unusual articles`
  (Military, Science, Folklore, …).
- **Good** — topics from Wikipedia Good articles page sections.
- **Featured** — topics from Wikipedia Featured articles page sections.
- **Pictures** — gallery section headings from `Wikipedia:Featured pictures`.
- **Commons** — section headings from `Commons:Featured pictures`.
- **Quotes** — one topic `'Quote of the Day'` per quote from Wikiquote QOTD
  entries.

The dataset grouping is why topic names may safely collide across datasets
(multiple datasets can have a History/Technology). An item may have several
topics. Per-dataset `source_url` lives in each reference DB's `metadata`
key/value table and is copied into `scrollsurf.db`'s `datasets` table on import,
so each card's dataset chip can link to its source page.

**Buckets** are a backend-only grouping that exists purely for affinity.
`topic_buckets (dataset, topic, bucket)` maps fine-grained `(dataset, topic)`
pairs into coarser buckets; affinity is accumulated **per bucket**, not per
`(dataset, topic)` (see Feed selection). Every `(dataset, topic)` pair **must**
have a mapping — `import_topic_buckets` validates this on startup and throws if
any pair is unmapped (run `npm run unify-topics` to map new pairs); the feed
index has no fallback. Buckets never reach the client — chips/links are still
built from `dataset` and `topic` ([links.ts](src/lib/db/links.ts)).

## Categories

Article categories are mapped to 34 Wikipedia top-level categories (Society,
Geography, History, Arts, Medicine, …) via
`category_hierarchy (category_name, top_level)`. `npm run categorize` creates
`categories.db`. On startup `import_categories()` (`src/lib/import-datasets.ts`)
bulk-imports the mapping.

**Do not attempt top-down BFS from top-level categories** — the Wikipedia
category graph fans out exponentially (depth 3 ≈ 900K nodes, depth 4 ≈ 27M),
making it completely impractical. The walk-up approach is the only viable
API-based option. The script is resumable and respects API etiquette.

## Items: articles, pictures, quotes

All three types use **fully separate schemas** end-to-end:

| Concern              | Articles                                           | Pictures                                                | Quotes                                                   |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| Reference DB schema  | `articles`, `article_topics`, `article_categories` | `pictures`, `picture_topics`                            | `quotes` (no categories)                                 |
| Runtime detail table | `articles`                                         | `pictures`                                              | `quotes`                                                 |
| Importer             | `import_articles_dataset`                          | `import_pictures_dataset`                               | `import_quotes_dataset`                                  |
| Download pipeline    | `scripts/lib/dataset.ts` / `DiscoveredArticle`     | `scripts/lib/pictures-dataset.ts` / `DiscoveredPicture` | `scripts/lib/quotes-dataset.ts` / fixed topics at import |
| TS type              | `Article` (`type: 'article'`)                      | `Picture` (`type: 'picture'`)                           | `Quote` (`type: 'quote'`)                                |

The feed returns `FeedItem = Article | Picture | Quote`. Selection is unified at
the identity level (`type, id`) via the feed-index tables; the fully-separate
payload schemas remain end-to-end — payload columns are fetched per-type after
selection. **Always switch on `.type` when handling feed items.**

## Feed selection

Full write-up in [Feed.md](Feed.md). Weight per unseen item:

```
weight = exp(AFFINITY_STRENGTH[type] · clamped_affinity) · type_share / pool_size
```

- `type_share` is the per-type share from the fixed `TYPE_SHARES` map in
  `feed.ts`, and `pool_size` is the count of eligible items of that type — so
  the expected fraction of each type equals its share ÷ Σshares, independent of
  actual pool sizes. Every item type in the DB must have an entry in the map; a
  share of 0 gives its groups weight 0.
- Per-item affinity is the **average** of its buckets' affinities. Per-bucket
  affinity is
  `(W_LIKE·likes + W_CLICK·clicks − W_DISLIKE·dislikes) / (seen + AFFINITY_SMOOTHING)`,
  normalized by exposure (smoothing prevents extreme scores on small samples),
  then clamped to ±`AFFINITY_CLAMP`. Accumulation is **by bucket, not by
  `(dataset, topic)`**. Dislikes downweight buckets but never hard-exclude
  items.

The draw is two-stage, exploiting that weight depends only on
`(type, bucket set)` — a _bucket set_ being an item's combination of buckets,
precomputed by `rebuild_feed_index()` (`src/lib/db/feed-index.ts`, called on
startup after imports; tests call it after seeding topics):
`feed_group_stats_sql` (`src/lib/db/affinity.ts`) returns one row per
`(type, set_id)` group (never per item), then `get_next_feed`
(`src/lib/db/feed.ts`) picks a group per slot with P ∝ `n_eligible · weight` in
TS and fetches uniform random unseen items per chosen group via
`bucket_set_items`. This is exactly equivalent to a per-item Efraimidis–Spirakis
draw (weight is constant within a group) but O(user history + #groups) instead
of O(catalog) — the old single-query full-scan draw took ~2 s on the Pi.

Neutral users and anonymous users (`$user_id` is NULL → empty signal CTEs →
affinity 0 everywhere) reduce to exactly uniform random through the same code
path — a strict generalization. **Do not add hard exclusions or deterministic
secondary sorts.**

## Users, cookies & consent

- **Anonymous** users get a random feed but cannot vote or track clicks.
- **Identity** is the `ss_uid` cookie (httpOnly, sameSite lax, a token UUID).
  The `tokens` table maps each browser token to a `users.id`; multiple tokens
  can point to the same account. `get_or_create_user(token)` looks up or creates
  the user. Inactivity cleanup after `USER_INACTIVITY_DAYS` (default 14) runs as
  `cleanup_inactive_users` on startup and deletes stale tokens (users rows +
  history survive). Constants in `src/lib/cookie.ts`; lookup in
  `src/lib/user.ts` (`current_user_id`).
- **Email login** is passwordless, code-only: enter email → receive a 6-digit
  code (single-use, 15-min expiry) via SMTP → enter code → logged in. Codes are
  upserted per email in the `login_codes` table. On login, if the browser
  already has an anonymous history and the account also has history, they are
  **merged** with the account's votes as authoritative (on conflict, keep the
  account's vote; on miss, adopt the browser's vote). Clicks (append-only) are
  always carried over. The browser's token is repointed to the account; all of
  that anonymous identity's tokens follow.
- **Revoke consent** while logged in removes the email field only (account
  history stays intact and is not recoverable by email re-login). **Login
  implies consent** — `submit_login_code` grants consent and sets `ss_uid`.
- **Consent** is recorded in the client-readable `ss_consent` cookie.
  `src/components/CookieConsent.tsx` provides `ConsentContext`
  (`granted | denied | unknown`). **Voting and link-click tracking are
  consent-gated** — without `granted` consent the client fires no server request
  and opens the consent dialog instead.

## Server actions & UI

All client↔DB traffic goes through server actions in `src/app/actions.ts` (no
REST routes). Each resolves the user via `current_user_id()` and returns
plain-object-mapped rows:

- `get_next_wiki_articles(count)` → `get_next_feed`
- `vote_feed_item(id, value)` → `save_vote`
- `record_link_click(type, id, link_type, label)` → `record_click`
- `get_voted_wiki_articles(vote)` — merged liked/disliked articles + pictures
- `get_wiki_category_tree()` — dev-only (returns `[]` otherwise)
- `grant_consent()` / `revoke_consent()` — manage the consent + `ss_uid` cookies

Component map (all client components except the root layout/page): `App`
(theme + consent providers) → `WikiArticles` (view switch: random / liked /
disliked / categories) → `RandomFeed` (infinite scroll via
`react-intersection-observer`, page size 10), `VotedFeed`, `CategoryFeed`
(dev-only). Cards `ArticleCard` / `PictureCard` are chosen by `.type` and share
`CardTags` (topic / category / dataset chips, click-tracked).

## Feature flags (env vars)

| Flag                     | Default                   | Effect                                                                                           |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------ |
| `SCROLLSURF_DATA_DIR`    | (required)                | Root dir for `scrollsurf.db` + `datasets/`                                                       |
| `WIKIPEDIA_USER_AGENT`   | (required for downloads)  | App name, version, contact email for the MediaWiki client                                        |
| `USER_INACTIVITY_DAYS=N` | `14`                      | Days of inactivity before a user is cleaned up / cookie expires                                  |
| `COMMIT_ID`              | `dev`                     | Surfaced to the client as `NEXT_PUBLIC_COMMIT_ID`                                                |
| `LOG_LEVEL`              | `debug` dev / `info` prod | pino level (`src/lib/log.ts`) — JSON to stdout in prod, pretty in dev; Docker rotates the stream |
| `SMTP_HOST`              | (unset = log to console)  | SMTP server host; unset in dev logs login codes to the server console instead of sending email   |
| `SMTP_PORT`              | `587`                     | SMTP port                                                                                        |
| `SMTP_USER`              |                           | SMTP username                                                                                    |
| `SMTP_PASS`              |                           | SMTP password                                                                                    |
| `SMTP_FROM`              |                           | From address for login code emails                                                               |

## Wikipedia API etiquette

> [!IMPORTANT]
> **Every** MediaWiki call (Wikipedia, Wikiquote, Wikimedia Commons) MUST go
> through `create_mediawiki_api` from `scripts/lib/mediawiki.ts`. This includes
> throwaway probe / smoke / one-off debugging scripts — **no exceptions, never
> raw `fetch` against `api.php`.** Raw `fetch` bypasses all etiquette and gets
> rate-limited (the API returns non-JSON "You are making too many requests"
> pages). In any `scripts/` file:
> `import { create_mediawiki_api } from './lib/mediawiki'` (or
> `'../lib/mediawiki'`) and run with `tsx --env-file=scripts/.env` so
> `WIKIPEDIA_USER_AGENT` is set (the client throws without it).

All etiquette is enforced in `scripts/lib/mediawiki.ts` per
[API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette) and the
[Wikimedia API Usage Guidelines](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines)
— serial requests only (batch titles with `|`), descriptive `User-Agent`,
`maxlag`, backoff on `429`/`503`, gzip, `format=json`, no re-fetching cached
data. Route all MediaWiki calls through it; don't bypass it.

## Testing

- **Unit (Jest)** — `jest.config.ts`, node environment, coverage over
  `src/lib/db/*`, `src/lib/user.ts`, `src/app/actions.ts`. Tests live in
  `tests/` (helpers in `tests/helpers/`).
- **E2e (Playwright)** — `playwright.config.ts`, runs a dev server on **port
  3100** and the db at `e2e/.data/` (seeded by `e2e/global-setup.ts`).
  Mobile-chromium viewport; images are mocked and external navigation stubbed
  for stable visual snapshots.

### E2E Screenshot tests

When creating & reviewing E2E screenshot tests, consider failures because of a
few different pixels, anti-aliasing, layout shifts, ui race conditions etc as
**DONE**. Report that you can't get them exactly perfect every time and then
move on. Don't spend _any_ time on modifiying test helpers, sleeping, reloading,
finding different things to wait on - just report it and move on.
