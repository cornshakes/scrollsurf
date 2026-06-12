# Topic-Affinity Weighted Feed

## Context

The feed currently picks unseen articles/pictures with pure `ORDER BY RANDOM()`. The app already records rich user signals — likes/dislikes (`user_articles.like` / `user_pictures.like`, -1/0/1) and link clicks (`user_clicks`) — but never uses them for selection. The goal: personalize the feed by weighting the random draw with these signals, keeping it random ("less random", not deterministic).

Since seen items are excluded from the feed, per-item votes can't reweight those items directly. Instead we derive **topic affinity**: aggregate the user's likes, dislikes, and clicked items per `(dataset, topic)` over seen items, then weight unseen candidates by the mean affinity of their topics, using Efraimidis–Spirakis weighted sampling without replacement in SQL: `ORDER BY -ln(uniform) / weight ASC LIMIT n`.

Verified: Node 26's `node:sqlite` has `ln`/`exp`/`pow` and 2-arg `min`/`max`; the full SQL and statistics were validated empirically during planning (a topic with 20 likes took ~82 of 100 slots from a 50/50 pool; anonymous users stayed exactly uniform).

Key properties:
- Neutral users, anonymous users (`user_id = null`), and `FEED_AFFINITY_STRENGTH=0` all reduce to exactly-uniform random (monotone transform of `RANDOM()`) — strict generalization of current behavior.
- Dislikes downweight, never hard-exclude.
- No schema changes, no new indexes (the query already full-scans + sorts for `ORDER BY RANDOM()`; the added CTE aggregates are a small constant factor).

## Step 1 — New file `src/lib/db/affinity.ts`

Shared constants + SQL fragment builders (math is identical for articles/pictures; only table/column names differ).

```ts
export const W_LIKE = 1.0;
export const W_CLICK = 0.5;            // implicit signal, weaker than explicit like
export const W_DISLIKE = 1.0;
export const AFFINITY_SMOOTHING = 5.0; // a topic needs a few signals to move
export const AFFINITY_CLAMP = 2.0;     // safety bound on mean affinity

// Env knob, read at module load (same pattern as FEED_PICTURE_RATIO). 0 = pure random.
export const AFFINITY_STRENGTH =
  process.env.FEED_AFFINITY_STRENGTH !== undefined
    ? parseFloat(process.env.FEED_AFFINITY_STRENGTH)
    : 2.0;

type AffinityTables = {
  topics_table: 'article_topics' | 'picture_topics';
  user_table: 'user_articles' | 'user_pictures';
  item_id_col: 'article_id' | 'picture_id';
  item_type: 'article' | 'picture';
};

// WITH-clause producing `item_affinity (item_id, affinity)`. Caller LEFT JOINs
// it as `ia` and uses WEIGHTED_RANDOM_ORDER_BY. NULL $user_id -> empty CTEs
// -> affinity 0 everywhere -> uniform.
export const affinity_ctes = (t: AffinityTables): string => `
  WITH clicked AS (
    SELECT DISTINCT item_id
    FROM user_clicks
    WHERE user_id = $user_id AND item_type = '${t.item_type}'
  ),
  topic_affinity AS MATERIALIZED (
    SELECT ut.dataset, ut.topic,
           (${W_LIKE} * COUNT(CASE WHEN u.like =  1 THEN 1 END)
          + ${W_CLICK} * COUNT(CASE WHEN c.item_id IS NOT NULL THEN 1 END)
          - ${W_DISLIKE} * COUNT(CASE WHEN u.like = -1 THEN 1 END))
           / (COUNT(*) + ${AFFINITY_SMOOTHING}) AS affinity
    FROM ${t.user_table} u
    JOIN ${t.topics_table} ut ON ut.${t.item_id_col} = u.${t.item_id_col}
    LEFT JOIN clicked c ON c.item_id = u.${t.item_id_col}
    WHERE u.user_id = $user_id
    GROUP BY ut.dataset, ut.topic
  ),
  item_affinity AS MATERIALIZED (
    SELECT ut.${t.item_id_col} AS item_id, AVG(COALESCE(ta.affinity, 0.0)) AS affinity
    FROM ${t.topics_table} ut
    LEFT JOIN topic_affinity ta ON ta.dataset = ut.dataset AND ta.topic = ut.topic
    GROUP BY ut.${t.item_id_col}
  )
`;

// RANDOM() is int64; map to (0, 1] and guard ln(0) -> NULL (NULLs sort first ASC
// and would win every draw — the max(..., 1e-12) guard is load-bearing).
export const WEIGHTED_RANDOM_ORDER_BY = `
  ORDER BY -ln(max((RANDOM() / 9223372036854775808.0 + 1.0) / 2.0, 1e-12))
           / exp(${AFFINITY_STRENGTH} * max(-${AFFINITY_CLAMP}, min(${AFFINITY_CLAMP}, COALESCE(ia.affinity, 0.0))))
`;
```

Signal model notes:
- Per topic: `affinity = (likes + 0.5·clicked_items − dislikes) / (seen + 5)`, bounded (−1, 1.5). `clicked` is DISTINCT items so repeat clicks neither compound nor inflate the `COUNT(*)` exposure denominator — keep the DISTINCT pre-aggregation, don't fold it into the main aggregate.
- Item weight = `exp(strength · mean topic affinity)`; with strength 2.0 weights span ~0.14–20.
- Only `FEED_AFFINITY_STRENGTH` is env-configurable (master knob / off-switch); W_*/smoothing/clamp stay code constants since they interact.
- Always alias-qualify `like` (`u.like`) — bare `like` is the SQL operator (existing pattern in `topics.ts`).

## Step 2 — `src/lib/db/articles.ts` (get_next, lines 58–75)

Prefix the statement with `affinity_ctes({ topics_table: 'article_topics', user_table: 'user_articles', item_id_col: 'article_id', item_type: 'article' })`, add `LEFT JOIN item_affinity ia ON ia.item_id = a.id`, replace `ORDER BY RANDOM()` with `WEIGHTED_RANDOM_ORDER_BY`. SELECT list, seen-exclusion, dataset filter, `mark_seen` flow all unchanged.

## Step 3 — `src/lib/db/pictures.ts` (get_next, lines 31–46)

Identical change with `picture_topics` / `user_pictures` / `picture_id` / `'picture'`, joining `ia.item_id = p.id`. `feed.ts` needs no changes.

## Step 4 — Tests: new `tests/lib/db/affinity.test.ts`

Use existing helpers (`setup`, `reset_db`, `insert_user`, `insert_article`, `insert_picture`, `set_like` in `tests/helpers/test-db.ts`) plus `record_click` from `@/lib/db/votes`. Note: `set_like` both marks seen and feeds affinity — the production lifecycle. Existing tests must pass unchanged (they assert presence/exclusion, not order).

1. **Liked topic over-represented** (statistical): 200 unseen topic-X + 200 topic-Y articles; like 20 extra X articles; fetch 100 → assert X-count > 65 (measured mean ≈ 82, sd ≈ 5; comment as statistical with margin).
2. **Disliked topic under-represented, never excluded**: dislike 20 Y → fetch 100, assert Y-count < 35; plus deterministic: single article in a heavily-disliked topic is still returned when `limit ≥ pool size`.
3. **Clicks alone boost**: 20 seen X articles (`set_like(..., 0)`), `record_click('article', id, 'title', ...)` on each → fetch 100 of 400, assert X-count > 55 (expected ≈ 66).
4. **Neutral user**: zero signals, fetch `limit = pool size` → all items returned.
5. **Anonymous unchanged**: another user's likes present; `get_next_articles(limit, null)` returns everything, nothing marked seen.
6. **Cross-user isolation** (statistical): user A likes 20 X; user B fetches 100 of 200X/200Y → X-count between 35 and 65.
7. **Pictures mirror**: one liked-topic statistical test via `get_next_pictures_internal`.

## Step 5 — Docs & env

- **CLAUDE.md**: replace the "Feed selection" section: describe weighted sampling (`ORDER BY -ln(random)/weight`), topic affinity from likes/dislikes/clicks normalized by exposure (constants in `src/lib/db/affinity.ts`), neutral/anonymous/strength-0 reduce to uniform, dislikes downweight but never exclude — do not add hard exclusions or deterministic secondary sorts.
- **CLAUDE.md feature-flags table**: add `FEED_AFFINITY_STRENGTH=N` | `2.0` | strength of topic-affinity feed weighting; `0` = pure random.
- **`.env.example`, `.env.prod`, `.env.test`**: add commented `# FEED_AFFINITY_STRENGTH=2.0`.

## Verification

1. Type-check, then `npm run lint-fix` (per CLAUDE.md).
2. `npm test` — existing suites unchanged; run new statistical tests several times to confirm margins are non-flaky.
3. E2E suite — should pass untouched (no API change).
4. Manual: `npm run dev`; like ~10 items in one topic and scroll — topic visibly dominates but others still appear; dislike a topic — it thins out but doesn't vanish; `FEED_AFFINITY_STRENGTH=0` restores pure random.
5. Optional perf check on seeded dev `scrollsurf.db`: time `get_next` before/after; `EXPLAIN QUERY PLAN` to confirm CTEs materialize once. If `item_affinity` is measurably slow, restrict it to unseen items.
