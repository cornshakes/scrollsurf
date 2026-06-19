# Tasks: Unify feed items under a global-id supertype

## TOC

- [x] 1. Write migration v5 (schema transform) [sonnet]
- [x] 2. Rewrite articles.ts & pictures.ts fetch functions [haiku]
- [x] 3. Collapse affinity.ts to single type-agnostic arm [sonnet]
- [x] 4. Update feed.ts for global item ids [haiku]
- [x] 5. Rewrite topics.ts queries [haiku]
- [x] 6. Simplify votes.ts set_like [haiku]
- [x] 7. Update db/index.ts exports [haiku]
- [x] 8. Update actions.ts set_like call [haiku]
- [x] 9. Rewrite import-datasets.ts importers [sonnet]
- [x] 10. Update e2e/global-setup.ts [haiku]
- [x] 11. Rewrite test-db.ts helpers [haiku]
- [x] 12. Rewrite affinity, articles, pictures unit tests [sonnet]
- [x] 13. Rewrite migrate.test.ts [sonnet]

---

## 1. Write migration v5 (schema transform) [sonnet]

**File:** `src/lib/db/migrations.ts`

Append a new migration object at version 5. The migration runner wraps it in a transaction with `foreign_keys = OFF`, so no `BEGIN/COMMIT` and drop order is unconstrained.

Steps in the `up` string:
1. `DROP VIEW IF EXISTS feed_items;`
2. Rename existing content tables: `ALTER TABLE articles RENAME TO _old_articles;` and `ALTER TABLE pictures RENAME TO _old_pictures;`
3. `CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE);`
4. Populate `items` from old tables:
   - `INSERT INTO items (type, title, url) SELECT 'article', title, url FROM _old_articles;`
   - `INSERT INTO items (type, title, url) SELECT 'picture', title, url FROM _old_pictures;`
5. Create new detail tables `articles` and `pictures` (per target schema in plan), plus `item_topics`, `item_categories`, `user_items`.
6. Migrate content via URL bridge:
   - `INSERT INTO articles (item_id, extract, description, image_url) SELECT i.id, o.extract, o.description, o.image_url FROM _old_articles o JOIN items i ON i.url = o.url;`
   - `INSERT INTO pictures (item_id, image_url, caption, credit) SELECT i.id, o.image_url, o.caption, o.credit FROM _old_pictures o JOIN items i ON i.url = o.url;`
7. Migrate topics + categories via URL bridge:
   - `item_topics` from `article_topics` + `picture_topics` (JOIN through `_old_articles`/`_old_pictures` → `items`)
   - `item_categories` from `article_categories` (JOIN through `_old_articles` → `items`)
8. Migrate votes:
   - `INSERT INTO user_items (user_id, item_id, like) SELECT u.user_id, i.id, u.like FROM user_articles u JOIN _old_articles o ON o.id = u.article_id JOIN items i ON i.url = o.url;`
   - Same from `user_pictures`/`_old_pictures`.
9. Remap `user_clicks.item_id` in place for each type using URL bridge; delete orphan clicks.
10. Drop old tables: `user_articles`, `user_pictures`, `article_topics`, `picture_topics`, `article_categories`, `_old_articles`, `_old_pictures`.
11. Create hot-path indexes: `item_topics(item_id)`, `items(type)`, `user_items(user_id)`.

---

## 2. Rewrite articles.ts & pictures.ts fetch functions [haiku]

**Files:** `src/lib/db/articles.ts`, `src/lib/db/pictures.ts`

- Rewrite `fetch_articles_by_ids(ids, user_id)` to join `items i JOIN articles a ON a.item_id = i.id LEFT JOIN user_items ui ON ui.item_id = i.id AND ui.user_id = ?`. Select `i.id, i.type, i.title, i.url, a.extract, a.description, a.image_url, COALESCE(ui.like, 0) AS like`.
- Rewrite `fetch_pictures_by_ids(ids, user_id)` equivalently with `pictures` detail columns.
- Rewrite `get_voted_articles` and `get_voted_pictures` to query `items + articles/pictures + user_items WHERE ui.like = ?`.
- Delete `get_next_articles`, `get_next_articles_internal`, `get_next_pictures_internal`, `set_article_like`, `set_picture_like`.
- `row_to_article` / `row_to_picture` mappers are unchanged (same output shape; `id` is now the global id).

---

## 3. Collapse affinity.ts to single type-agnostic arm [sonnet]

**File:** `src/lib/db/affinity.ts`

Rewrite `feed_affinity_ctes()` to a single arm — no more separate article/picture branches and `UNION ALL`:

- `clicked`: all of the calling user's clicks from `user_clicks` — no `item_type` filter (global ids prevent collisions).
- `topic_affinity`: `user_items u JOIN item_topics it ON it.item_id = u.item_id` — computes per-topic score from likes/clicks/dislikes.
- `item_affinity (item_id, affinity)`: grouped by `it.item_id`.
- `eligible_pool (type, id)`: `SELECT type, id FROM items` where the item is unseen in `user_items` AND exists in `item_topics`.
- `pool_size`: `COUNT(*)` per type from `eligible_pool`.

Delete the `AffinityTables` type and `affinity_ctes` function if they exist. Keep `weighted_random_order_by`, `topic_affinity_score`, and all constants.

---

## 4. Update feed.ts for global item ids [haiku]

**File:** `src/lib/db/feed.ts`

- Update the `item_affinity` join to `ON ia.item_id = p.id` (drop any `item_type` filter).
- Collapse mark-seen to a single `INSERT OR IGNORE INTO user_items (user_id, item_id) VALUES (?, ?)` — no per-type branch.
- Keep the `$ratio` / `type_share` `CASE` expression (article-vs-picture ratio is a product knob).
- Keep grouping result rows by `.type` for the payload fetch dispatch (`fetch_articles_by_ids` / `fetch_pictures_by_ids`).

---

## 5. Rewrite topics.ts queries [haiku]

**File:** `src/lib/db/topics.ts`

- `fetch_topics_by_item(item_id)`: drop the `(table, col)` parameters, replace with a single `SELECT dataset, topic FROM item_topics WHERE item_id = ?`.
- Category-tree queries (`GET_TOP_LEVELS_SQL`, `GET_CATEGORIES_SQL`): repoint `article_categories → item_categories`, `articles → items` (add `WHERE items.type = 'article'`), `user_articles → user_items`.

---

## 6. Simplify votes.ts set_like [haiku]

**File:** `src/lib/db/votes.ts`

- `set_like(user_id, type, id, value)`: remove the `type` branch entirely. Write a single `INSERT INTO user_items (user_id, item_id, like) VALUES (?,?,?) ON CONFLICT(user_id, item_id) DO UPDATE SET like = excluded.like`.
- Drop the `type` parameter from the signature.
- `record_click` keeps `item_type` (denormalized analytics convenience — no change needed).

---

## 7. Update db/index.ts exports [haiku]

**File:** `src/lib/db/index.ts`

Remove the re-exports for: `get_next_articles`, `set_article_like`, `set_picture_like` (deleted in task 2 and 6). Ensure all new/remaining exports from `articles.ts`, `pictures.ts`, `votes.ts` are present.

---

## 8. Update actions.ts set_like call [haiku]

**File:** `src/app/actions.ts`

- `set_article_like(type, id, value)`: keep the existing server action signature (client contract is unchanged), but stop forwarding `type` to `set_like` — call `set_like(user_id, id, value)` instead.

---

## 9. Rewrite import-datasets.ts importers [sonnet]

**File:** `src/lib/import-datasets.ts`

Both importers become two-step:

**Articles (`import_articles_dataset`):**
1. `INSERT OR IGNORE INTO items (type, title, url) VALUES ('article', ?, ?)` for each article from the reference DB.
2. `INSERT OR IGNORE INTO articles (item_id, extract, description, image_url) SELECT i.id, ?, ?, ? FROM items i WHERE i.url = ?` for detail columns.
3. `item_topics` and `item_categories` inserts joined the same way via `items.url`.

**Pictures (`import_pictures_dataset`):**
1. `INSERT OR IGNORE INTO items (type, title, url) VALUES ('picture', ?, ?)`.
2. `INSERT OR IGNORE INTO pictures (item_id, image_url, caption, credit) ... ON CONFLICT(item_id) DO UPDATE SET caption = excluded.caption WHERE pictures.caption = ''` (preserves the "fill empty caption" upsert).
3. `item_topics` insert via `items.url`.

---

## 10. Update e2e/global-setup.ts [haiku]

**File:** `e2e/global-setup.ts`

Mirror the two-step importer pattern (the setup has its own copy filtered by `wanted_urls`):
1. Insert into `items` first, then detail tables (`articles`/`pictures`), then `item_topics`.
2. Update any `count(…)` log statements to reference the new table names (`items`, `user_items`, etc.).

---

## 11. Rewrite test-db.ts helpers [haiku]

**File:** `tests/helpers/test-db.ts`

- `insert_article(db, fields)`: insert a row into `items (type='article', title, url)`, then into `articles (item_id, extract, description, image_url)`, then into `item_topics` and `item_categories` if provided. Return `items.id`.
- `insert_picture(db, fields)`: same shape for `pictures` detail.
- `set_like(db, user_id, item_id, value)`: write to `user_items` instead of `user_articles`/`user_pictures`.

---

## 12. Rewrite affinity, articles, pictures unit tests [sonnet]

**Files:** `tests/affinity.test.ts`, `tests/articles.test.ts`, `tests/pictures.test.ts`

- Replace all calls to deleted `get_next_articles` / `get_next_pictures_internal` with `get_next_feed`.
- For article-only assertions: set `FEED_PICTURE_RATIO=0` via `jest.resetModules()` / env before import (pattern already documented in `feed.ts`).
- For picture-only assertions: set `FEED_PICTURE_RATIO=1`.
- Filter result arrays by `.type` where a test only cares about one type.
- Ensure affinity behavior (topic weighting, like/dislike, seen exclusion) is fully covered through `get_next_feed`.

---

## 13. Rewrite migrate.test.ts [sonnet]

**File:** `tests/migrate.test.ts`

- Update expected `user_version` from 4 to 5.
- Update table/view assertions: `feed_items` view gone; `items`, `user_items`, `item_topics`, `item_categories` present; `articles` and `pictures` are now detail tables (have `item_id`, no standalone `id`).
- Add a data-preservation case:
  1. Open a fresh DB and manually apply migrations 1–4 to get to v4 schema.
  2. Seed v4-shaped data: at least one article, one picture, one vote each, one click each.
  3. Run `migrate` to apply v5.
  4. Assert: votes land in `user_items` with correct `item_id`s; `user_clicks.item_id` remapped to global ids; content rows and topics survive; old tables dropped.
