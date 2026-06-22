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

## Integration Testing

All e2e tests run against a small example database (`e2e/.data/`).
That database is created from the downloaded datasets using the test:e2e:create-db script.
It is committed so that you don't have to download all datasets before being able to run e2e tests.

```bash
npm run test:e2e            # run all integration tests (seeds DB automatically)
npm run playwright-ui       # same, but with Playwright's interactive UI
npm run test:e2e:update     # updates screenshots
```

## Clicks, Likes & Dislikes

The feed is random, but influenced by user activity. Three signals are tracked **per topic** (e.g. Vital → History):

- Like counts +1
- Dislike counts −1
- Following a link counts +0.5

These are averaged over seen articles of that topic, so a topic needs a few signals before it starts to move — one stray like won't change much. 

Unseen articles are then drawn with weights based on the average affinity of their topics, i.e. liked topics show up more often, disliked topics show up less.

Without any votes (or without the consent cookie) the feed is random.

### Example

Say you've scrolled for a while and your history per topic looks like this:

| Topic | Seen | Likes | Dislikes | Clicks | Affinity = (likes + 0.5·clicks − dislikes) / (seen + 5) |
|---|---|---|---|---|---|
| Vital → History | 15 | 6 | 0 | 2 | (6 + 1 − 0) / 20 = **0.35** |
| Vital → Sports | 15 | 0 | 6 | 0 | (0 + 0 − 6) / 20 = **−0.30** |
| Vital → Arts | 4 | 1 | 0 | 0 | (1 + 0 − 0) / 9 = **0.11** |
| anything you haven't voted on | | | | | **0** |

The `+ 5` in the denominator is the smoothing: the lone Arts like only gets a third of the affinity of the six History likes, even though it's a 100% like rate.

Each unseen article then gets a weight of `exp(2 · affinity)` (the `2` is `FEED_AFFINITY_STRENGTH`):

| Article tagged | Mean affinity | Weight |
|---|---|---|
| History | 0.35 | exp(0.70) ≈ **2.0** |
| Sports | −0.30 | exp(−0.60) ≈ **0.55** |
| Arts | 0.11 | exp(0.22) ≈ **1.25** |
| History **and** Sports | (0.35 − 0.30) / 2 = 0.025 | exp(0.05) ≈ **1.05** |
| no voted topics | 0 | exp(0) = **1.0** |

The weight is the article's relative chance per feed slot: a History article is about twice as likely to appear as a neutral one, and about 3.7× as likely as a Sports one — but even Sports articles keep showing up at roughly half the neutral rate. An article tagged with both a liked and a disliked topic lands back near neutral, because affinities are averaged across its topics.

### The SQL behind it

There are no per-topic queries and no mixing of result sets in TypeScript — the whole draw happens inside **one SELECT** per item type. The statement is assembled from shared SQL fragments in `src/lib/db/affinity.ts` (the constants from the example are baked into the string; only `$user_id` and `$limit` are bound at query time) and chains three CTEs before the actual selection:

```sql
WITH clicked AS (              -- distinct items you clicked links on
  SELECT DISTINCT item_id FROM user_clicks WHERE user_id = $user_id ...
),
topic_affinity AS (            -- the first table from the example:
  SELECT dataset, topic,       -- one GROUP BY over your seen items
         (likes + 0.5*clicks - dislikes) / (seen + 5) AS affinity
  FROM user_articles JOIN article_topics ... LEFT JOIN clicked ...
  WHERE user_id = $user_id
  GROUP BY dataset, topic
),
item_affinity AS (             -- the second table: AVG over each item's topics
  SELECT article_id AS item_id, AVG(COALESCE(affinity, 0)) AS affinity
  FROM article_topics LEFT JOIN topic_affinity ...
  GROUP BY article_id
)
SELECT a.* FROM articles a
LEFT JOIN item_affinity ia ON ia.item_id = a.id
WHERE <unseen, dataset enabled>
ORDER BY -ln(random_0_to_1) / exp(2 * ia.affinity)   -- the weighted draw
LIMIT $limit
```

The `ORDER BY` line is the whole sampling trick ([Efraimidis–Spirakis](https://en.wikipedia.org/wiki/Reservoir_sampling#Weighted_random_sampling)): every candidate row draws its own uniform random number, the weight stretches it, and taking the smallest `n` keys is mathematically the same as drawing `n` items without replacement with probability proportional to weight. So the "randomness" and the "weighting" live in the same expression — there's no second pass, no shuffle in TS.

For anonymous users `$user_id` is `NULL`, which matches nothing in the CTEs, so every item falls back to affinity `0` → weight `1` → plain uniform random, through the exact same query.

Pictures and quotes run through the same unified query. The weight term includes a per-type share factor (the fixed `TYPE_SHARES` map in `feed.ts`), so each type's expected fraction equals its share ÷ Σshares, independent of actual pool sizes. One query per feed page returns all three types, with per-type payload columns fetched after selection.

## Future inspiration 

These [Main topic classifications](https://en.wikipedia.org/wiki/Category:Main_topic_classifications) are not what I have

[Wikipedia:Contents](https://en.wikipedia.org/wiki/Wikipedia:Contents)

[why not reddit](https://www.reddit.com/r/wikipedia/comments/11nnbzx/i_maintain_a_list_of_500_of_my_favourite/)

[Wikipedia:Categorization](https://en.wikipedia.org/wiki/Wikipedia:Categorization)
