# Plan: Unify articles + pictures behind a `feed_items` view and fold `FEED_PICTURE_RATIO` into the SQL weighting

## Goal

Today the feed is assembled by two independent weighted-random queries (one per
type) stitched together in JavaScript:

- [src/lib/db/articles.ts](../../src/lib/db/articles.ts) `get_next_articles_internal`
- [src/lib/db/pictures.ts](../../src/lib/db/pictures.ts) `get_next_pictures_internal`
- [src/lib/db/feed.ts](../../src/lib/db/feed.ts) `get_next_feed` — does a hard
  `round(count * PICTURE_RATIO)` split, fetches each type separately, then
  interleaves with even spacing and backfills the shortfall.

This means the picture ratio is a JS post-processing step, not part of the
selection. Articles and pictures can never compete in a single weighted draw, so
the ratio is enforced as an exact count + fixed spacing rather than as a
*weighting*.

End state:

1. A **`feed_items` SQL view** unifies the two item tables into one
   `(type, id)` relation so both kinds can be selected in a single query.
2. `get_next_feed` becomes **one** Efraimidis–Spirakis weighted draw over that
   unified pool. `FEED_PICTURE_RATIO` enters as a **per-type weight multiplier**
   inside the existing `ORDER BY -ln(U)/weight` expression — no JS split, no JS
   interleaving, no spacing pass.
3. The probabilistic ratio is a **strict generalization** of the affinity model
   already documented in CLAUDE.md: `RATIO=0` ⇒ no pictures, `RATIO=1` ⇒ no
   articles, and per-type affinity weighting is unchanged within each type.

## Why a view (not a materialized table)

A plain `CREATE VIEW` is the right tool:

- The union is trivial and cheap (`type, id` only — no payload columns), so a
  materialized copy would buy no query speed worth the cost.
- A real table would need refresh hooks wired into every dataset import in
  [src/instrumentation.ts](../../src/instrumentation.ts) and would drift out of
  sync between imports. A view is always consistent by construction and needs
  zero maintenance.
- It respects the "fully separate schemas end-to-end" invariant in CLAUDE.md:
  the view unifies **identity only** (`type` + `id`), never the divergent
  article/picture payload columns. Payload is still fetched per type.

```sql
CREATE VIEW IF NOT EXISTS feed_items AS
  SELECT 'article' AS type, id FROM articles
  UNION ALL
  SELECT 'picture' AS type, id FROM pictures;
```

Eligibility (unseen + has-topic) and user-specific joins are deliberately **not**
baked into the view — it must stay user-agnostic. Those predicates live in the
selection query.

## The weighting math

Efraimidis–Spirakis assigns each candidate the sort key `-ln(U) / weight`
(`U` uniform in `(0,1]`); the probability an item leads the draw is proportional
to its `weight`. Today every item's weight is `exp(strength · affinity)`. We
multiply in a per-type factor so the *expected* share of pictures equals the
ratio `r`, independent of pool sizes:

```
weight(item) = exp(strength · affinity) · type_share / pool_size(type)

  type_share   = r       for pictures,  (1 - r) for articles
  pool_size    = count of eligible items of that type
```

Because `Σ picture weights = r` and `Σ article weights = (1 - r)` regardless of
how many of each are eligible, the expected leading share is exactly `r`. This is
the key reason to normalize by `pool_size`: without it a 50k-article / 5k-picture
corpus would swamp pictures even at `r = 0.5`. Backfill falls out for free — if
one type's pool is tiny, its few items simply carry larger per-item weight while
the other type fills the rest, mirroring today's behavior but probabilistically.

### Division-by-zero guard (load-bearing)

SQLite returns **NULL**, not `inf`, for `x/0`, and NULLs sort *first* under
`ORDER BY ASC` — they would win every draw (the same hazard the existing
`max(..., 1e-12)` comment in [affinity.ts](../../src/lib/db/affinity.ts) guards).
So the weight denominator must stay strictly positive:

- `pool_size` is floored with `max(n, 1)`.
- A zero `type_share` (i.e. `r = 0` or `r = 1`) must **exclude** that type in the
  `WHERE` clause rather than divide it to a zero weight. So the pool itself drops
  the unwanted type: `WHERE (type='picture' AND $ratio > 0) OR (type='article' AND $ratio < 1)`.

With those two guards every surviving row has a finite, strictly-positive weight.

## End state — code

### Migration (new, append-only)

Add version 4 to [src/lib/db/migrations.ts](../../src/lib/db/migrations.ts)
creating the view. `CREATE VIEW IF NOT EXISTS` is transaction-safe and idempotent,
fitting the existing runner rules (no `BEGIN/COMMIT`, no non-transactional
PRAGMA). Per the migrations memory: append a new entry, never edit a shipped one.

```ts
{
  version: 4,
  name: 'add_feed_items_view',
  up: (db) => {
    db.exec(`
      CREATE VIEW IF NOT EXISTS feed_items AS
        SELECT 'article' AS type, id FROM articles
        UNION ALL
        SELECT 'picture' AS type, id FROM pictures;
    `);
  },
},
```

### Unified affinity helper — [src/lib/db/affinity.ts](../../src/lib/db/affinity.ts)

The current `affinity_ctes(t)` emits a single-type `item_affinity (item_id,
affinity)`. Add a sibling that emits a **type-tagged** union so one query can
look up affinity for both kinds. It reuses the same per-type CTE body for each
arm (likes/dislikes/clicks normalized by exposure, smoothing 5) — only the table
names and the literal `item_type` differ.

```ts
// Emits item_affinity (item_type, item_id, affinity) over both item types,
// plus eligible_pool (type, id) and pool_size (type, n). NULL $user_id -> empty
// signal CTEs -> affinity 0 everywhere -> per-type uniform (unchanged).
export const feed_affinity_ctes = (): string => `...`;
```

This keeps all weighting SQL in one place. The existing single-type
`affinity_ctes` stays as-is (still used by the per-type internal functions and
their tests). Factor the shared topic-affinity sub-expression so the two builders
don't duplicate the formula.

### Shared by-id hydration — articles.ts / pictures.ts

The unified selection returns only `(type, id)` in sampled order, so we need to
hydrate each type from its ids. Extract the payload `SELECT` that
`get_next_*_internal` runs inline today into reusable batch fetchers:

```ts
// articles.ts
export const fetch_articles_by_ids = (ids: number[], user_id: number | null): Article[]
// pictures.ts
export const fetch_pictures_by_ids = (ids: number[], user_id: number | null): Picture[]
```

Each: `WHERE id IN (placeholders)`, `LEFT JOIN user_*` for the `like` flag, then
attach topics (`fetch_topics_by_item`) and, for articles, visible categories
(`fetch_visible_categories`), mapping rows to plain object literals via the
existing `row_to_article` / `row_to_picture`. These reuse the helpers already
introduced in plan 06; no `GROUP_CONCAT`, no null-prototype rows leaking out.

### Rewritten `get_next_feed` — [src/lib/db/feed.ts](../../src/lib/db/feed.ts)

One prepared selection query, then type-split hydration preserving order:

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

where `eligible_pool` filters `feed_items` to unseen + has-topic rows (the
type-branched `EXISTS`/`NOT EXISTS` predicates), and `pool_size` is its
`COUNT(*) GROUP BY type`. The `-ln(...)/weight` shape and constants match
`weighted_random_order_by` exactly — only the extra `type_share / pool_size`
factor is new. (Optionally generalize `weighted_random_order_by` to accept an
extra weight-factor expression so the formula still lives in one function;
keeping the constants single-sourced matters more than the exact call shape.)

TypeScript flow:

```ts
const PICTURE_RATIO = process.env.FEED_PICTURE_RATIO !== undefined
  ? parseFloat(process.env.FEED_PICTURE_RATIO) : 0.2;

export const get_next_feed = (count: number, user_id: number | null): FeedItem[] => {
  const db = get_db();
  const rows = db.prepare(FEED_GET_NEXT_SQL)
    .all({ $limit: count, $user_id: user_id, $ratio: PICTURE_RATIO }) as
    unknown as { type: 'article' | 'picture'; id: number }[];

  const article_ids = rows.filter((r) => r.type === 'article').map((r) => r.id);
  const picture_ids = rows.filter((r) => r.type === 'picture').map((r) => r.id);

  // hydrate each type, index by id, then re-emit in the sampled order
  const a = new Map(fetch_articles_by_ids(article_ids, user_id).map((x) => [x.id, x]));
  const p = new Map(fetch_pictures_by_ids(picture_ids, user_id).map((x) => [x.id, x]));

  if (user_id !== null) {
    db.exec('BEGIN');
    // INSERT OR IGNORE into user_articles / user_pictures per id
    db.exec('COMMIT');
  }
  return rows.map((r) => (r.type === 'article' ? a.get(r.id)! : p.get(r.id)!));
};
```

Mark-seen stays a single transaction wrapping both types. `id` collisions across
types are fine — the result is keyed by `(type, id)` via the two maps.

### What is removed

- The `round(count * ratio)` split, the even-spacing `step` loop, and the
  backfill arithmetic in `feed.ts` — all subsumed by the SQL draw.
- `get_next_articles_internal` / `get_next_pictures_internal` are **kept** (still
  exercised directly by the affinity tests and exported `get_next_articles`), but
  refactored to call the new `fetch_*_by_ids` for hydration so the payload
  `SELECT` is single-sourced. `get_voted_*` likewise.

## Behavior change to call out

The picture ratio becomes **expected**, not exact. A 10-item page at `r = 0.2`
averages 2 pictures but a given page may have 1 or 3, and placement is random
rather than evenly stepped. This is intentional and matches the affinity
doctrine in CLAUDE.md ("Do not add hard exclusions or deterministic secondary
sorts"). The boundary guarantees stay hard: `r = 0` ⇒ zero pictures, `r = 1` ⇒
zero articles, exhausted pool ⇒ the other type fills in.

## Tests

Rewrite [tests/lib/db/feed.test.ts](../../tests/lib/db/feed.test.ts) around the
probabilistic contract (Jest, existing `tests/helpers/test-db.ts` seeders):

- **Deterministic boundaries** (non-flaky):
  - `r = 0` ⇒ every item is an article; `r = 1` ⇒ every item is a picture
    (load via `jest.resetModules()` + dynamic import with `FEED_PICTURE_RATIO`
    set, per the pattern the current file documents).
  - Pool smaller than `count` ⇒ returns the whole pool, no duplicates.
  - Only articles exist ⇒ all articles; only pictures exist ⇒ all pictures.
  - Logged-in user: items are marked seen (second call excludes them); null user:
    nothing marked seen.
  - Result never exceeds `count`; every returned object is fully hydrated
    (topics present, articles carry categories, plain object literals).
- **Statistical ratio** (seed a large pool, draw many, assert the picture share
  sits within a ~3σ band of `r` — same convention as
  [tests/lib/db/affinity.test.ts](../../tests/lib/db/affinity.test.ts), with the
  measured mean/sd noted in a comment). Replaces the old exact-count and
  even-spacing assertions.
- **Affinity still applies across the unified draw**: a user who likes a
  picture topic gets that topic over-represented *among the pictures drawn*,
  confirming per-type affinity survives unification.

Keep [tests/lib/db/affinity.test.ts](../../tests/lib/db/affinity.test.ts),
[articles.test.ts](../../tests/lib/db/articles.test.ts),
[pictures.test.ts](../../tests/lib/db/pictures.test.ts) green (the internal
functions are preserved). Add a `migrate.test.ts` assertion that version 4
creates the `feed_items` view and that a pre-existing DB upgrades cleanly. The
e2e feed specs ([e2e/tests/feed.spec.ts](../../e2e/tests/feed.spec.ts)) should
pass unchanged since `get_next_feed`'s signature and `FeedItem[]` contract are
identical.

## Docs

Update the **Feed selection** and **Pictures vs articles** sections of
[CLAUDE.md](../../CLAUDE.md): there is now a single `get_next_feed` weighted draw
over the `feed_items` view; `FEED_PICTURE_RATIO` is a per-type weight multiplier
(`type_share / pool_size`) rather than a JS split + spacing; and note `RATIO=0/1`
as the hard boundaries. Update the `FEED_PICTURE_RATIO` flag row accordingly.

## Verification

1. `npm run type-check` then `npm run lint-fix` (required by CLAUDE.md).
2. `npm test` — unit/integration green.
3. `npm run dev` and sanity-check the feed mixes both types; flip
   `FEED_PICTURE_RATIO=0` / `=1` / `=0.5` and confirm the share shifts.
