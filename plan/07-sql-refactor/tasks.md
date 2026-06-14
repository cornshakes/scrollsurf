# Tasks: Unify feed selection behind `feed_items` view

## TOC

- [x] Add `feed_items` view as migration version 4 [haiku]
- [x] Extract `fetch_articles_by_ids` from `get_next_articles_internal` [sonnet]
- [x] Extract `fetch_pictures_by_ids` from `get_next_pictures_internal` [haiku]
- [x] Refactor `get_next_articles_internal` to use `fetch_articles_by_ids` [haiku]
- [x] Refactor `get_next_pictures_internal` to use `fetch_pictures_by_ids` [haiku]
- [x] Add `feed_affinity_ctes` unified CTE builder to affinity.ts [sonnet]
- [x] Rewrite `get_next_feed` as a single SQL draw in feed.ts [sonnet]
- [x] Add version 4 view assertion to migrate.test.ts [haiku]
- [x] Rewrite feed.test.ts for the probabilistic contract [sonnet]
- [x] Update CLAUDE.md feed docs [haiku]

---

## 1. Add `feed_items` view as migration version 4

**File:** `src/lib/db/migrations.ts`

Append a new entry `{ version: 4, name: 'add_feed_items_view', up }` to the migrations array. The `up` function calls `db.exec` with:

```sql
CREATE VIEW IF NOT EXISTS feed_items AS
  SELECT 'article' AS type, id FROM articles
  UNION ALL
  SELECT 'picture' AS type, id FROM pictures;
```

No `BEGIN/COMMIT`, no PRAGMA — matches the existing runner rules. Do not edit any prior entries.

---

## 2. Extract `fetch_articles_by_ids` from `get_next_articles_internal`

**File:** `src/lib/db/articles.ts`

Pull the payload `SELECT` that `get_next_articles_internal` currently runs inline into a new exported function:

```ts
export const fetch_articles_by_ids = (ids: number[], user_id: number | null): Article[]
```

- `WHERE id IN (?, ?, …)` using a dynamic placeholder list.
- `LEFT JOIN user_articles` for the `like` flag.
- Call `fetch_topics_by_item` and `fetch_visible_categories` per the existing hydration pattern.
- Map every row through `row_to_article` to plain object literals (no null-prototype rows).
- The function must preserve the `ids` input order in its result.

---

## 3. Extract `fetch_pictures_by_ids` from `get_next_pictures_internal`

**File:** `src/lib/db/pictures.ts`

Mirror task 2 for pictures:

```ts
export const fetch_pictures_by_ids = (ids: number[], user_id: number | null): Picture[]
```

- `WHERE id IN (?, …)`, `LEFT JOIN user_pictures`, call `fetch_topics_by_item`, map via `row_to_picture`.
- No categories (pictures don't have `fetch_visible_categories`).
- Preserve input order; return plain object literals.

---

## 4. Refactor `get_next_articles_internal` to use `fetch_articles_by_ids`

**File:** `src/lib/db/articles.ts`

Replace the inline hydration SELECT in `get_next_articles_internal` with a call to `fetch_articles_by_ids`. The weighted-random selection query that yields the `id` list stays; only the hydration step changes. `get_voted_articles` (if it duplicates the same payload SELECT) should do the same.

This single-sources the payload SELECT so both callers stay in sync.

---

## 5. Refactor `get_next_pictures_internal` to use `fetch_pictures_by_ids`

**File:** `src/lib/db/pictures.ts`

Same as task 4 for pictures: keep the per-type weighted selection, replace inline hydration with `fetch_pictures_by_ids`. Update `get_voted_pictures` similarly if it duplicates the payload SELECT.

---

## 6. Add `feed_affinity_ctes` unified CTE builder to affinity.ts

**File:** `src/lib/db/affinity.ts`

Add a new exported function alongside the existing `affinity_ctes`:

```ts
export const feed_affinity_ctes = (): string => `...`
```

It returns a SQL string with these CTEs:

- `item_affinity (item_type, item_id, affinity)` — a `UNION ALL` of the article-affinity arm and picture-affinity arm. Each arm is the same likes/dislikes/clicks-over-exposure formula as today, differing only in table names (`user_articles` vs `user_pictures`, `article_topics` vs `picture_topics`) and the literal `'article'`/`'picture'` type tag.
- `eligible_pool (type, id)` — joins `feed_items` to filter unseen + has-topic rows (type-branched `NOT EXISTS` / `EXISTS` predicates matching what the per-type queries currently do inline).
- `pool_size (type, n)` — `SELECT type, COUNT(*) FROM eligible_pool GROUP BY type`.

Factor the shared topic-affinity sub-expression (the `SUM(…) / (exposure + 5)` formula) into a named fragment or helper so neither arm duplicates it.

The existing `affinity_ctes(t)` is **not changed** — it is still used by the per-type internal functions and their tests.

---

## 7. Rewrite `get_next_feed` as a single SQL draw in feed.ts

**File:** `src/lib/db/feed.ts`

Remove: the `round(count * ratio)` split, the even-spacing `step` loop, and the backfill arithmetic. Replace with:

**Selection SQL** (one prepared statement):

```sql
${feed_affinity_ctes()}
SELECT p.type, p.id
FROM eligible_pool p
JOIN pool_size ps ON ps.type = p.type
LEFT JOIN item_affinity ia ON ia.item_type = p.type AND ia.item_id = p.id
WHERE (p.type = 'picture' AND $ratio > 0)
   OR (p.type = 'article' AND $ratio < 1)
ORDER BY
  -ln(max((RANDOM() / 9223372036854775808.0 + 1.0) / 2.0, 1e-12))
  / ( exp(${AFFINITY_STRENGTH} * max(-${AFFINITY_CLAMP}, min(${AFFINITY_CLAMP}, COALESCE(ia.affinity, 0.0))))
      * (CASE p.type WHEN 'picture' THEN $ratio ELSE 1.0 - $ratio END)
      / max(ps.n, 1) )
LIMIT $limit
```

**TypeScript flow:**

```ts
const rows = db.prepare(SQL).all({ $limit, $user_id, $ratio }) as { type: 'article'|'picture'; id: number }[];
const article_ids = rows.filter(r => r.type === 'article').map(r => r.id);
const picture_ids = rows.filter(r => r.type === 'picture').map(r => r.id);
const a = new Map(fetch_articles_by_ids(article_ids, user_id).map(x => [x.id, x]));
const p = new Map(fetch_pictures_by_ids(picture_ids, user_id).map(x => [x.id, x]));
// mark-seen in one transaction (both types)
return rows.map(r => r.type === 'article' ? a.get(r.id)! : p.get(r.id)!);
```

`PICTURE_RATIO` is parsed from `process.env.FEED_PICTURE_RATIO` (default `0.2`), matching the existing constant location.

---

## 8. Add version 4 view assertion to migrate.test.ts

**File:** `tests/lib/db/migrate.test.ts`

Add a test that:
1. Runs migrations on a fresh in-memory DB.
2. Asserts the `feed_items` view exists (e.g. query `sqlite_master WHERE type='view' AND name='feed_items'`).
3. Asserts it returns both `'article'` and `'picture'` rows after inserting one article and one picture.
4. Also asserts a pre-existing DB (already at version 3) upgrades cleanly to version 4.

---

## 9. Rewrite feed.test.ts for the probabilistic contract

**File:** `tests/lib/db/feed.test.ts`

Replace exact-count and even-spacing assertions with:

**Deterministic boundary tests (non-flaky):**
- `FEED_PICTURE_RATIO=0` → every returned item is an article.
- `FEED_PICTURE_RATIO=1` → every returned item is a picture.
- Pool smaller than `count` → returns whole pool, no duplicates.
- Only articles seeded → all articles; only pictures seeded → all pictures.
- Logged-in user: a second `get_next_feed` call excludes items from the first (mark-seen). Null user: nothing marked seen.
- Result length ≤ `count`; every item is fully hydrated (topics present; articles carry categories); all items are plain object literals (no null prototype).

**Statistical ratio test:**
- Seed a large pool (e.g. 500 articles, 100 pictures), draw many pages, assert the picture fraction sits within a ±3σ band of `FEED_PICTURE_RATIO`. Note the measured mean/sd in a comment (same convention as `affinity.test.ts`).

**Affinity-survives-unification test:**
- Seed a user with strong likes on a picture topic. Draw many items. Assert that the picture-topic share among pictures drawn is higher than the baseline — confirming per-type affinity is intact after unification.

Use `jest.resetModules()` + dynamic import with env vars set when ratio needs to vary across test cases, per the pattern already in the file.

---

## 10. Update CLAUDE.md feed docs

**File:** `CLAUDE.md`

Update two sections:

**Feed selection** — describe that `get_next_feed` now issues a single Efraimidis–Spirakis draw over the `feed_items` view. `FEED_PICTURE_RATIO` is a per-type weight multiplier (`type_share / pool_size`) folded into the `ORDER BY -ln(U)/weight` expression. Remove references to the JS split and interleaving. Note `RATIO=0` → zero pictures (hard boundary via `WHERE`), `RATIO=1` → zero articles.

**Pictures vs articles** — note that identity-level unification (`feed_items` view) exists for feed selection; the fully-separate schemas end-to-end invariant still holds for all payload columns.

**Feature flags table** — update the `FEED_PICTURE_RATIO` row description to say "per-type weight multiplier in the unified SQL draw" instead of whatever it currently says.
