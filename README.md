# Scrollsurf

[Visit this app on my raspberry](https://scrollsurf.tail812f0.ts.net) and read the [diary](./DIARY.md)!


Scrollsurf lets you scroll through wikipedia article abstracts, like/dislike them, and visit the full articles on wikipedia itself. The articles that it shows you are randomly selected from these datasets:

- [The 50000 most vital articles](https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level_5)

- [The Unusual articles page](https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles)

- [Wikipedia Good articles](https://en.wikipedia.org/wiki/Wikipedia:Good_articles)

- [Wikipedia Featured articles](https://en.wikipedia.org/wiki/Wikipedia:Featured_articles)

- [Wikipedia Featured pictures](https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures)

- [Wikimedia Featured pictures](https://commons.wikimedia.org/wiki/Commons:Featured_pictures)

- [Wikiquote Quote of the Day](https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month)

## Getting Started

```bash
npm install
```

Before you run the app for the first time, you have to download the datasets that you want using the provided package scripts.
The downloads take a long time, but one dataset is enough to run the app:
First, you have to add an .env file in scripts/, next to .env.example, and add your own User-Agent. Then you can

```bash
npm run download-vital-50000
npm run download-unusual
npm run download-good-articles
npm run download-featured-articles
npm run download-featured-pictures
npm run download-commons-featured-pictures
npm run download-quotes
```

Then, you can categorize the articles by running

```bash
npm run categorize
```

Currently, that's not very useful - it just builds a huge category tree that you can look at.
After downloading at least one dataset, you can

```bash
npm run dev
```

and go to [http://localhost:3000](http://localhost:3000)

## Clicks, Likes & Dislikes

Different datasets come with slightly different topics per item, e.g. "Military" and "Warfare". To be able to better use topics in influencing the random feed, these topics have been manually grouped into "buckets". The `topic_buckets` table maps each `(dataset, topic)` pair to its bucket; an unmapped pair is its own bucket. The signals:
The feed is random, but influenced by user activity. Three signals are tracked **per bucket**.

- Like counts +1
- Dislike counts −1
- Following a link counts +0.5

These are averaged over seen items of that bucket, so a bucket needs a few signals before it starts to move — one stray like won't change much. 

Unseen items are then drawn with weights based on the average affinity of their buckets, i.e. liked buckets show up more often, disliked buckets show up less.

Without any votes (or without the consent cookie) the feed is random.

### Example

Say you've scrolled for a while and your history per bucket looks like this:

| Bucket | Seen | Likes | Dislikes | Clicks | Affinity = (likes + 0.5·clicks − dislikes) / (seen + 5) |
|---|---|---|---|---|---|
| Vital → History | 15 | 6 | 0 | 2 | (6 + 1 − 0) / 20 = **0.35** |
| Vital → Sports | 15 | 0 | 6 | 0 | (0 + 0 − 6) / 20 = **−0.30** |
| Vital → Arts | 4 | 1 | 0 | 0 | (1 + 0 − 0) / 9 = **0.11** |
| anything you haven't voted on | | | | | **0** |

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

### The SQL behind it

There are no per-topic queries and no mixing of result sets in TypeScript — the whole draw happens inside **one SELECT** over all three item types. Items (articles, pictures, quotes) share a unified `items` supertype and a single `item_topics` table, so the selection is type-agnostic; per-type payload columns are fetched afterwards. The statement is assembled from shared SQL fragments in `src/lib/db/affinity.ts` (the constants from the example are baked into the string; only `$user_id` and `$limit` are bound at query time) and chains a handful of CTEs (`src/lib/db/affinity.ts`) before the actual selection (`src/lib/db/feed.ts`):

```sql
WITH clicked AS (              -- distinct items you clicked links on
  SELECT DISTINCT item_id FROM user_clicks WHERE user_id = $user_id
),
item_buckets AS (             -- map each item's (dataset, topic) rows to buckets
  SELECT DISTINCT item_id,
         COALESCE(bucket, dataset || topic) AS bucket  -- unmapped pair → its own bucket
  FROM item_topics LEFT JOIN topic_buckets USING (dataset, topic)
),
bucket_affinity AS (           -- the first table from the example, grouped by bucket:
  SELECT bucket,               -- one GROUP BY over your seen items
         (1.0*likes + 0.5*clicks - 1.0*dislikes) / (seen + 5) AS affinity
  FROM user_items JOIN item_buckets USING (item_id) LEFT JOIN clicked ...
  WHERE user_id = $user_id
  GROUP BY bucket
),
item_affinity AS (             -- the second table: AVG over each item's buckets
  SELECT item_id, AVG(COALESCE(affinity, 0)) AS affinity
  FROM item_buckets LEFT JOIN bucket_affinity USING (bucket)
  GROUP BY item_id
),
eligible_pool AS (             -- unseen items that have at least one topic
  SELECT type, id FROM items WHERE <unseen by $user_id> AND <has a topic>
),
pool_size AS (                 -- count of eligible items per type
  SELECT type, COUNT(*) AS n FROM eligible_pool GROUP BY type
)
SELECT p.type, p.id
FROM eligible_pool p
JOIN pool_size ps ON ps.type = p.type
LEFT JOIN item_affinity ia ON ia.item_id = p.id
WHERE p.type IN ('article', 'picture', 'quote')
ORDER BY
  -ln(random_0_to_1)
  / ( exp(2 * clamp(ia.affinity, -2, 2))     -- affinity weight
      * type_share                            -- TYPE_SHARES[p.type]
      / max(ps.n, 1) )                        -- ÷ pool size of that type
LIMIT $limit
```

The `ORDER BY` line is the whole sampling trick ([Efraimidis–Spirakis](https://en.wikipedia.org/wiki/Reservoir_sampling#Weighted_random_sampling)): every candidate row draws its own uniform random number, the weight stretches it, and taking the smallest `n` keys is mathematically the same as drawing `n` items without replacement with probability proportional to weight. So the "randomness" and the "weighting" live in the same expression — there's no second pass, no shuffle in TS.

The weight has two factors. The first is the affinity term from the example (clamped to ±2). The second is a per-type share: `type_share / pool_size`, where `type_share` is the fixed `TYPE_SHARES` map in `feed.ts` (article 0.82, picture 0.1, quote 0.08) and `pool_size` is the count of eligible items of that type. Dividing by pool size makes each type's expected fraction equal its share ÷ Σshares, independent of how many items each pool actually holds. A type with share 0, or absent from the map, is hard-excluded by the `WHERE` clause.

For anonymous (and brand-new) users `$user_id` is `NULL`, which matches nothing in the signal CTEs, so every item falls back to affinity `0` → uniform within each type, through the exact same query. The selected `(type, id)` rows are then hydrated into full `Article` / `Picture` / `Quote` payloads per type.

## Integration Testing

All e2e tests run against a small example database (`e2e/.data/`).
That database is created from the downloaded datasets using the test:e2e:create-db script.
It is committed so that you don't have to download all datasets before being able to run e2e tests.

```bash
npm run test:e2e            # run all integration tests (seeds DB automatically)
npm run playwright-ui       # same, but with Playwright's interactive UI
npm run test:e2e:update     # updates screenshots
```

## Future inspiration 

These [Main topic classifications](https://en.wikipedia.org/wiki/Category:Main_topic_classifications) are not what I have

[Wikipedia:Contents](https://en.wikipedia.org/wiki/Wikipedia:Contents)

[why not reddit](https://www.reddit.com/r/wikipedia/comments/11nnbzx/i_maintain_a_list_of_500_of_my_favourite/)

[Wikipedia:Categorization](https://en.wikipedia.org/wiki/Wikipedia:Categorization)
