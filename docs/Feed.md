# The Feed: Clicks, Likes & Dislikes

The feed is random, but influenced by user activity. This document explains the affinity model, the SQL behind it, and how the weighted random draw works.

Each feed item belongs to at least one *topic bucket*. Liking or clicking an item makes its buckets more likely to appear again; disliking makes them rarer. Think of each page as a lottery over all unseen items, where an item's bucket affinity sets how many tickets it holds — 10 winners per page. (Formally: weighted sampling without replacement, à la [Efraimidis–Spirakis](https://en.wikipedia.org/wiki/Reservoir_sampling#Weighted_random_sampling).)

## Buckets

Different datasets come with slightly different topics per item, e.g. "Military" and "Warfare". So the feed can treat those as one interest, topics are manually grouped into "buckets". The `topic_buckets` table maps each `(dataset, topic)` pair to its bucket; every pair must be mapped (startup validates this and fails loudly otherwise). Three signals are tracked **per bucket**:

- Like counts +1
- Dislike counts −1
- Following a link counts +0.5

These are averaged over seen items of that bucket, so a bucket needs a few signals before it starts to move — one stray like won't change much.

Unseen items are then drawn with weights based on the average affinity of their buckets, i.e. liked buckets show up more often, disliked buckets show up less.

Without any likes, dislikes or clicks (or without the consent cookie) the feed is random.

## Example

Say you've scrolled for a while and your history per bucket looks like this:

| Bucket | Seen | Likes | Dislikes | Clicks | Affinity = (likes + 0.5·clicks − dislikes) / (seen + 5) |
|---|---|---|---|---|---|
| History | 15 | 6 | 0 | 2 | (6 + 1 − 0) / 20 = **0.35** |
| Sports | 15 | 0 | 6 | 0 | (0 + 0 − 6) / 20 = **−0.30** |
| Arts | 4 | 1 | 0 | 0 | (1 + 0 − 0) / 9 = **0.11** |
| Not voted on | | | | | **0** |

The `+ 5` in the denominator is the smoothing: the lone Arts like only gets a third of the affinity of the six History likes, even though it's a 100% like rate.

Each bucket's affinity is clamped to ±2 (`AFFINITY_CLAMP`) so no single bucket can run away. Each unseen item then gets a weight of `exp(2 · affinity)` (the `2` is `AFFINITY_STRENGTH`):

| Item tagged | Mean affinity | Weight |
|---|---|---|
| History | 0.35 | exp(0.70) ≈ **2.0** |
| Sports | −0.30 | exp(−0.60) ≈ **0.55** |
| Arts | 0.11 | exp(0.22) ≈ **1.25** |
| History **and** Sports | (0.35 − 0.30) / 2 = 0.025 | exp(0.05) ≈ **1.05** |
| no voted buckets | 0 | exp(0) = **1.0** |

The weight is the item's relative chance per feed slot: a History item is about twice as likely to appear as a neutral one, and about 3.7× as likely as a Sports one — but even Sports items keep showing up at roughly half the neutral rate. An item in both a liked and a disliked bucket lands back near neutral, because affinities are averaged across its buckets.

## Performance improvement - Bucket sets: the precomputed feed index

### In short:
```
The old draw had to
- do a lot of joinery to map every user item to its (possibly multiple) topic_buckets
- count all existing items per topic bucket / type

The new draw depends on an index rebuilt on every startup.
- uses bucket sets for each possible combination of topic_buckets and maps them straight to items
- uses pre-calculated item counts per bucket set / type
```
### Now, let me give the microphone back to the AI:

The key observation making the draw fast: an item's affinity is the average over its buckets, so **two items with the same combination of buckets always have the same affinity** — and, since the only other weight ingredient is the item's type, the same draw weight. That combination is called a *bucket set*. A catalog of ~120K items with ~33 buckets collapses to under ~200 distinct sets.

`rebuild_feed_index()` ([src/lib/db/feed-index.ts](src/lib/db/feed-index.ts)) precomputes this grouping into three derived tables, rebuilt on startup after dataset import (topics and bucket mappings only change at import):

- `bucket_set_items (item_id, type, set_id)` — each item's set.
- `bucket_set_buckets (set_id, bucket)` — the buckets making up each set.
- `bucket_set_counts (type, set_id, item_count)` — items per `(type, set)` group.

`set_id`s are minted per rebuild and are not stable across restarts. Buckets and sets never reach the client — chips/links are still built from `dataset` and `topic`.

### The two-stage draw

`get_next_feed` ([src/lib/db/feed.ts](src/lib/db/feed.ts)) turns the group rows into feed items. Each item's weight is

```
weight = exp(AFFINITY_STRENGTH[type] · clamped_affinity) · TYPE_SHARES[type] / pool_size(type)
```

— the affinity factor from the example, plus a per-type factor that keeps each type at a fixed share of the feed. `pool_size` is how many unseen items of that type remain; dividing by it is what makes the shares hold no matter how large each catalog is. `TYPE_SHARES` (`feed.ts`): article 0.82, picture 0.1, quote 0.08 — every item type in the DB must have an entry, and a share of 0 gives its groups weight 0. Quotes have `AFFINITY_STRENGTH` 0 since they all share one topic and likes must not flood the feed with them.

The literal Efraimidis–Spirakis draw would now visit **every unseen item**: give each a random score tilted by its weight, sort, take the top 10. That full-catalog pass per request took ~2 s on the Raspberry Pi.

But nothing in the weight formula is per-item: affinity depends only on the bucket set, the rest only on the type. Every item in a `(type, set_id)` group has the **same weight**, so an item-level draw is overkill — drawing one weighted item is the same as first drawing its *group* (a group's total chance is just its weight times its size), then picking any of the group's members with equal chance. That splits the draw into two cheap stages:

1. **Pick a group per feed slot** with probability ∝ `n_eligible · weight`, decrement that group's `n_eligible`, repeat `count` times — in TypeScript, over the few hundred group rows from the stats query.
2. **Pick uniform random unseen items within each chosen group** — one indexed `ORDER BY RANDOM() LIMIT k` query per distinct chosen group over `bucket_set_items`.

Decrementing `n_eligible` in stage 1 is what makes the repeated group picks equivalent to sampling `count` items without replacement. The distribution is exactly the per-item draw's — the weighting lives in stage 1, the randomness within a group in stage 2 — but the cost is O(groups) + a few indexed lookups instead of O(catalog): tens of ms instead of ~2 s.

Two properties fall out of the design rather than being special-cased:

- Dislikes only shrink a group's weight, never exclude it, and nothing is deterministically ordered — with `count` ≥ pool the full pool comes back, just in weighted-random order.
- Anonymous and brand-new users (`$user_id` is `NULL`) have no history for the query to find, so every group gets affinity 0 and the same code path degenerates to a uniform random feed within each type.

The selected `(type, id)` rows are recorded as seen (so they never come up again for this user) and then hydrated into full `Article` / `Picture` / `Quote` payloads per type.



## The SQL behind it

Items (articles, pictures, quotes) share a unified `items` supertype and a single `item_topics` table, so selection is type-agnostic; per-type payload columns are fetched afterwards. Per request, one small query (`feed_group_stats_sql` in [src/lib/db/affinity.ts](src/lib/db/affinity.ts)) computes **one row per `(type, set_id)` group** — never anything per item (the constants from the example are baked into the string; only `$user_id` is bound at query time):

```sql
WITH clicked AS (               -- distinct items you clicked links on
  SELECT DISTINCT item_id FROM user_clicks WHERE user_id = $user_id
),
topic_affinity AS (             -- the first table from the example, grouped by
  SELECT bucket,                -- bucket: one GROUP BY over your seen items
         (1.0*likes + 0.5*clicks - 1.0*dislikes) / (seen + 5) AS affinity
  FROM user_items
  JOIN bucket_set_items USING (item_id)      -- your seen items' sets
  JOIN bucket_set_buckets USING (set_id)    -- ...expanded to their buckets
  LEFT JOIN clicked ...
  WHERE user_id = $user_id
  GROUP BY bucket
),
set_affinity AS (               -- the second table: AVG over each set's buckets
  SELECT set_id, SUM(COALESCE(affinity, 0)) / COUNT(*) AS affinity
  FROM bucket_set_buckets LEFT JOIN topic_affinity USING (bucket)
  GROUP BY set_id
),
seen_counts AS (                -- how many of each group you have already seen
  SELECT type, set_id, COUNT(*) AS n_seen
  FROM user_items JOIN bucket_set_items USING (item_id)
  WHERE user_id = $user_id
  GROUP BY type, set_id
)
SELECT c.type, c.set_id,
       c.item_count - COALESCE(n_seen, 0) AS n_eligible,  -- unseen items in the group
       COALESCE(affinity, 0.0)   AS affinity
FROM bucket_set_counts c
LEFT JOIN seen_counts ... LEFT JOIN set_affinity ...
```

The cost is O(your history + number of groups), independent of catalog size.
