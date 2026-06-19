# Unify feed items under a global-id supertype

## Context

Articles and pictures are fully parallel schemas (`articles`/`article_topics`/`article_categories`/`user_articles` vs `pictures`/`picture_topics`/`user_pictures`), unified only by the `feed_items` **view** at the `(type, id)` identity level. We want to add more feed types later (quotes, newslinks, lists).

The *signal* tables — topics and votes/seen — are split per type, forcing `feed_affinity_ctes()` in [affinity.ts](../../src/lib/db/affinity.ts#L73-L146) to carry a **full near-identical arm per type** (`article_clicked → article_topic_affinity → article_item_affinity`, then the same for pictures, then a `UNION ALL`), plus a per-type branch in `eligible_pool`. Each new type adds another arm + branch.

We move to a **full supertype with a single global `items.id`** across all types. Global ids make the feed query the cleanest option — no composite `(type,id)` joins, no cross-type id collisions. **Existing user data is preserved**: every user's like/dislike votes and click-engagement log are migrated to the new schema, along with content/topics/categories, by bridging old per-type ids to new global ids via each item's `url` (`UNIQUE` in both old and new schemas; article page URLs and picture file-page URLs never collide).

**Outcome:** the entire affinity / eligible-pool / seen / vote machinery becomes type-agnostic and O(1) in type count. Adding a feed type touches a detail table + importer + a payload `switch` + a card — nothing in the hot feed path — and no existing user data is lost.

## Target schema (runtime `scrollsurf.db`)

Supertype + class-table detail. Shared scalars (`title`, `url`) live on `items`; type-specific columns stay in per-type detail tables keyed by `item_id`. Topics/categories stay many-to-many.

```sql
CREATE TABLE items (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  type  TEXT    NOT NULL,                 -- 'article' | 'picture' | future
  title TEXT    NOT NULL,
  url   TEXT    NOT NULL UNIQUE           -- natural key; article page vs commons file page never collide
);
CREATE TABLE articles (                   -- detail
  item_id     INTEGER PRIMARY KEY REFERENCES items(id),
  extract     TEXT NOT NULL,
  description TEXT,
  image_url   TEXT
);
CREATE TABLE pictures (                   -- detail
  item_id   INTEGER PRIMARY KEY REFERENCES items(id),
  image_url TEXT NOT NULL,
  caption   TEXT NOT NULL DEFAULT '',
  credit    TEXT
);
CREATE TABLE item_topics (                -- replaces article_topics + picture_topics
  item_id INTEGER NOT NULL REFERENCES items(id),
  dataset TEXT NOT NULL, topic TEXT NOT NULL,
  PRIMARY KEY (item_id, dataset, topic)
);
CREATE TABLE item_categories (            -- replaces article_categories
  item_id     INTEGER NOT NULL REFERENCES items(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  PRIMARY KEY (item_id, category_id)
);
CREATE TABLE user_items (                 -- replaces user_articles + user_pictures
  user_id INTEGER NOT NULL REFERENCES users(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  like    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, item_id)
) STRICT;
```

- `feed_items` **view is dropped** — `items` is now the real identity table (`SELECT type, id FROM items`).
- `users`, `categories`, `datasets`, `category_hierarchy` are kept as-is (cookies persist; the latter three are derived and re-imported via `INSERT OR IGNORE`).
- `user_clicks` keeps its shape; its `item_id` is **remapped in place** to the global id. `item_type` stays (now denormalized, kept as a cheap analytics convenience).
- Hot-path indexes: `item_topics(item_id)`, `items(type)`, `user_items(user_id)`.

## Migration — append as version 5 in [migrations.ts](../../src/lib/db/migrations.ts)

A single data-preserving transform. The runner already brackets the loop with `foreign_keys = OFF` ([migrate.ts:37-68](../../src/lib/db/migrate.ts#L37-L68)) and owns the transaction, so no `BEGIN/COMMIT` and drop order is unconstrained. On a fresh DB (dev/e2e/test) the baseline migration has already created the source tables empty, so every `INSERT … SELECT` below copies zero rows — the migration is uniform across fresh and populated DBs.

The existing content tables (`articles`, `pictures`) share names with the new detail tables, so rename them aside first.

1. `DROP VIEW IF EXISTS feed_items;`
2. `ALTER TABLE articles RENAME TO _old_articles;` / `ALTER TABLE pictures RENAME TO _old_pictures;`
3. `CREATE TABLE items …`, then assign fresh global ids from existing content, preserving URLs:
   - `INSERT INTO items (type, title, url) SELECT 'article', title, url FROM _old_articles;`
   - `INSERT INTO items (type, title, url) SELECT 'picture', title, url FROM _old_pictures;`
   - (If an article and picture ever shared a URL this fails loudly on the `UNIQUE` constraint — a deliberate integrity guard, not silent data loss.)
4. `CREATE TABLE` the new `articles`, `pictures`, `item_topics`, `item_categories`, `user_items`.
5. **Content (URL bridge):**
   - `INSERT INTO articles (item_id, extract, description, image_url) SELECT i.id, o.extract, o.description, o.image_url FROM _old_articles o JOIN items i ON i.url = o.url;`
   - `INSERT INTO pictures (item_id, image_url, caption, credit) SELECT i.id, o.image_url, o.caption, o.credit FROM _old_pictures o JOIN items i ON i.url = o.url;`
6. **Topics + categories** (join association → old content → `items` by URL): `item_topics` from `article_topics` + `picture_topics`; `item_categories` from `article_categories`.
7. **Votes:** `INSERT INTO user_items (user_id, item_id, like) SELECT u.user_id, i.id, u.like FROM user_articles u JOIN _old_articles o ON o.id = u.article_id JOIN items i ON i.url = o.url;` and the same from `user_pictures`/`_old_pictures`.
8. **Clicks (remap in place):** delete any orphan clicks whose `item_id` no longer resolves (defensive — content is never deleted, so normally none), then two `UPDATE user_clicks SET item_id = (SELECT i.id FROM _old_* o JOIN items i ON i.url = o.url WHERE o.id = user_clicks.item_id) WHERE item_type = '…';`.
9. `DROP TABLE` the now-empty sources: `user_articles, user_pictures, article_topics, picture_topics, article_categories, _old_articles, _old_pictures`.
10. `CREATE INDEX` the three hot-path indexes above.

After migration, startup import is **purely additive**: `INSERT OR IGNORE INTO items (…url…)` skips already-present URLs (so ids and votes stay attached) and only adds genuinely new content — consistent with the "download-once, no backfill" rule ([[datasets-are-download-once-no-backfill]]).

## DB layer changes (`src/lib/db/`)

- **[affinity.ts](../../src/lib/db/affinity.ts)** — collapse `feed_affinity_ctes()` to a **single arm**: `clicked` (all of the user's clicks, no `item_type` filter — global ids make cross-type collision impossible), `topic_affinity` (`user_items u JOIN item_topics it ON it.item_id = u.item_id`), `item_affinity (item_id, affinity)` grouped by `it.item_id`, `eligible_pool (type, id)` = `items` unseen-in-`user_items` AND exists-in-`item_topics`, `pool_size` per type. **Delete** `affinity_ctes` and the `AffinityTables` type. Keep `weighted_random_order_by`, `topic_affinity_score`, and the constants.
- **[feed.ts](../../src/lib/db/feed.ts)** — `item_affinity` join becomes `ON ia.item_id = p.id` (no `item_type`). Mark-seen collapses to one `INSERT OR IGNORE INTO user_items (user_id, item_id) VALUES (…)`. Keep the `$ratio`/`type_share` `CASE` (article-vs-picture is a product knob, not per-type-table duplication). **Still group result rows by `.type`** for the payload fetch → `fetch_articles_by_ids` / `fetch_pictures_by_ids`.
- **[articles.ts](../../src/lib/db/articles.ts) / [pictures.ts](../../src/lib/db/pictures.ts)** — rewrite `fetch_*_by_ids` to `items i JOIN <detail> d ON d.item_id = i.id LEFT JOIN user_items ui … AND ui.user_id = ?` (select `i.id, i.title, i.url, d.*, COALESCE(ui.like,0)`). `row_to_article`/`row_to_picture` are unchanged (same shape; `id` is now the global id). Rewrite `get_voted_*` onto `items`+detail+`user_items`. **Delete** `get_next_articles[_internal]`, `get_next_pictures_internal`, `set_article_like`, `set_picture_like`.
- **[topics.ts](../../src/lib/db/topics.ts)** — `fetch_topics_by_item` drops its `(table, col)` params → single `item_topics` query keyed by `item_id`. Category-tree queries (`GET_TOP_LEVELS_SQL`/`GET_CATEGORIES_SQL`) repoint `article_categories → item_categories`, `articles → items` (filter `items.type='article'`), `user_articles → user_items`.
- **[votes.ts](../../src/lib/db/votes.ts)** — `set_like` loses its type branch → one `user_items` upsert (drop the `type` param). `record_click` keeps `item_type`.
- **[index.ts](../../src/lib/db/index.ts)** — drop the `get_next_articles` / `set_article_like` / `set_picture_like` exports.
- **[types.ts](../../src/lib/db/types.ts)** — no change to `Article`/`Picture`/`FeedItem`; the UI contract is untouched.
- **[actions.ts](../../src/app/actions.ts)** — keeps its existing signatures (`set_article_like(type, id, value)` etc.); the `type` arg is simply no longer forwarded to `set_like`.

`cleanup_inactive_users` ([users.ts](../../src/lib/db/users.ts)) only nulls `cookie_token`; it never deletes vote rows, so it needs no change and votes survive inactivity.

## Importers

- **[import-datasets.ts](../../src/lib/import-datasets.ts)** — both importers become two-step. Articles: `INSERT OR IGNORE INTO items (type='article', title, url)` from `ref.articles`; then `INSERT OR IGNORE INTO articles (item_id, …)` joining `items ON items.url = ref.url`; then `item_topics` / `item_categories` joined the same way. Pictures: same shape; move the existing "fill empty caption" upsert onto the `pictures` detail insert — `… ON CONFLICT(item_id) DO UPDATE SET caption = excluded.caption WHERE pictures.caption = ''`.
- **[e2e/global-setup.ts](../../e2e/global-setup.ts)** — mirror the two-step importer (its own copy filtered by `wanted_urls`); update the final `count(…)` log to the new table names.
- **[tests/helpers/test-db.ts](../../tests/helpers/test-db.ts)** — `insert_article`/`insert_picture` insert into `items` + detail + `item_topics` (+ `item_categories`), returning `items.id`; the helper `set_like` writes `user_items`.

Reference DBs and the `scripts/lib/*` download scripts are **unchanged** — they write reference schemas, which we don't touch.

## Tests to rewrite

- **affinity.test.ts, pictures.test.ts, articles.test.ts** — repoint from the deleted `get_next_*` helpers to `get_next_feed`, filtering by `.type` and setting `FEED_PICTURE_RATIO` (`0` for article-only assertions, `1` for picture-only) via the existing `jest.resetModules()` pattern noted in [feed.ts](../../src/lib/db/feed.ts#L7-L8).
- **migrate.test.ts** — update the expected `user_version` (5) and table/view assertions for the new schema. Add a data-preservation case: seed v4-shaped data (articles, pictures, votes, clicks) at `user_version = 4`, run `migrate`, and assert votes land in `user_items`, clicks are remapped to global ids, and content/topics survive.

## Verification

1. `npm run check`, then `npm run lint-fix`.
2. `npm test` — rewritten unit suites pass (affinity behavior now exercised through the real `get_next_feed`), including the new migrate preservation case.
3. Local migration smoke test: with an existing dev `scrollsurf.db` that already has votes/clicks (**do not delete it**), `npm run dev`; confirm the liked/disliked views still show the pre-existing votes, feed loads + infinite scroll, like/dislike persists, dev-only category tree renders.
4. `npm run test:e2e` (reseeds the fixture DB via the rewritten global-setup). Run `npm run test:e2e:update` only if a snapshot genuinely shifts — ids aren't rendered, so visuals should be stable.
5. Deploy: v5 transforms prod data in place. Recovery is restoring the DB file, so **back up the prod `scrollsurf.db` before deploy**; after the first startup, spot-check that `user_items` / `user_clicks` row counts match the pre-migration `user_articles + user_pictures` / `user_clicks` counts.

## Out of scope / just for reference: Adding a future type (e.g. quotes)

1. Reference DB + `download-*` script (existing pattern, unchanged).
2. Append a migration: `CREATE TABLE quotes (item_id PK REFERENCES items(id), …)`.
3. Importer: `INSERT … items (type='quote', …)` + `quotes` detail + `item_topics`.
4. `types.ts`: add `Quote extends BaseFeedItem { type:'quote'; … }` to the `FeedItem` union; add `quotes.ts` with `row_to_quote` + `fetch_quotes_by_ids`.
5. `feed.ts`: one new branch in the **payload** switch; `QuoteCard` chosen by `.type`.

No changes to `affinity.ts`, `eligible_pool`, `user_items`, `item_topics`, mark-seen, or `set_like`. One remaining type-literal spot to design when a 3rd type lands: the `FEED_PICTURE_RATIO` / `type_share` knob is currently binary (article vs picture); a 3rd type needs a ratio policy — a product decision, deliberately out of scope here.
