# Plan: Dataset-independent topic buckets for affinity

## Context

Topics today are scoped per-dataset: the key is `(item_id, dataset, topic)` and affinity is computed
`GROUP BY it.dataset, it.topic` in [affinity.ts:36-51](src/lib/db/affinity.ts#L36-L51). So a like on
**Good Articles → History** and a like on **Vital Articles → History** build two *separate* affinity
scores and never reinforce each other. We want likes to accumulate into a single cross-dataset **topic
bucket** ("History"), so positive signal in one dataset surfaces more History items from *every* dataset
(Unusual, Featured Pictures, …).

Decisions confirmed with the user:
- **Every bucket is user-approved — nothing merges automatically.** A `(dataset, topic)` only joins a
  shared bucket once the user assigns it one in the CLI (the CLI may *suggest* the topic name as the
  default, but the user confirms it). Until a pair is approved it keeps its own **isolated** affinity,
  exactly like today — identical names across datasets do **not** merge on their own.
- **UI: keep the dataset chip, replace the topic chip's label with the bucket.** Cards show `[dataset]
  [bucket]` instead of `[dataset] [topic]`. For an unapproved pair the displayed label is just the topic
  name, so cards look unchanged until you map them.

The unification mapping is authored via an **interactive CLI** that suggests a matching bucket, else lets
the user pick an existing bucket or type a new one — shipped as a reference DB and imported on startup,
exactly like `categories.db`.

## Approach

Introduce a `topic_buckets (dataset, topic, bucket)` mapping table, populated only by user-approved choices
from the CLI. **Affinity** groups by `COALESCE(topic_buckets.bucket, dataset||sep||topic)` — so an
unapproved pair keeps its own isolated bucket (today's behavior) and only approved pairs merge. **Display**
labels the topic chip with `COALESCE(topic_buckets.bucket, topic)` — an unapproved pair just shows its topic
name, so cards look unchanged until mapped. Dataset stays only as a display/source-link label.

### 1. Schema — append migration v10 ([migrations.ts](src/lib/db/migrations.ts))

Append (do **not** edit existing migrations):

```sql
CREATE TABLE topic_buckets (
  dataset TEXT NOT NULL,
  topic   TEXT NOT NULL,
  bucket  TEXT NOT NULL,
  PRIMARY KEY (dataset, topic)
);
```

### 2. Affinity — group by bucket ([affinity.ts](src/lib/db/affinity.ts#L35-L53))

Add an `item_buckets` CTE and rewrite `topic_affinity` / `item_affinity` to key on `bucket`:

```sql
item_buckets AS MATERIALIZED (
  -- Unapproved pairs fall back to a dataset-qualified key so they stay isolated
  -- (no auto-merge); only an explicit topic_buckets row merges across datasets.
  SELECT DISTINCT it.item_id,
         COALESCE(tb.bucket, it.dataset || char(31) || it.topic) AS bucket
  FROM item_topics it
  LEFT JOIN topic_buckets tb ON tb.dataset = it.dataset AND tb.topic = it.topic
),
topic_affinity AS MATERIALIZED (
  SELECT ib.bucket,
      ( ${W_LIKE} * COUNT(CASE WHEN u.like = 1 THEN 1 END)
      + ${W_CLICK} * COUNT(CASE WHEN c.item_id IS NOT NULL THEN 1 END)
      - ${W_DISLIKE} * COUNT(CASE WHEN u.like = -1 THEN 1 END)
      ) / (COUNT(*) + ${AFFINITY_SMOOTHING}) AS affinity
  FROM user_items u
  JOIN item_buckets ib ON ib.item_id = u.item_id
  LEFT JOIN clicked c ON c.item_id = u.item_id
  WHERE u.user_id = $user_id
  GROUP BY ib.bucket
),
item_affinity AS MATERIALIZED (
  SELECT ib.item_id, AVG(COALESCE(ta.affinity, 0.0)) AS affinity
  FROM item_buckets ib
  LEFT JOIN topic_affinity ta ON ta.bucket = ib.bucket
  GROUP BY ib.item_id
),
```

`DISTINCT` in `item_buckets` prevents an item that has the same bucket via two datasets (e.g. it is both
Good and Vital → History) from being double-counted. No change to `eligible_pool` / `pool_size`, the feed
draw in [feed.ts](src/lib/db/feed.ts#L49-L62), `AFFINITY_STRENGTH`, or quote handling (quotes remain a
single bucket, still strength 0).

### 3. Topic fetch + display

- **[topics.ts](src/lib/db/topics.ts#L5-L30)** — add the bucket to `fetch_topics_for_items`:
  `... it.topic, COALESCE(tb.bucket, it.topic) AS bucket, d.source_url` with
  `LEFT JOIN topic_buckets tb ON tb.dataset = it.dataset AND tb.topic = it.topic`; push `bucket` into each
  `Topic`.
- **[types.ts](src/lib/db/types.ts)** — add `bucket: string` to the `Topic` interface.
- **[CardTags.tsx:82-114](src/components/CardTags.tsx#L82-L114)** — destructure `bucket`; set the topic
  `Chip` `label={bucket}` (keep the dataset chip as-is). Keep the href anchored to the raw `topic`
  (`topic_url`) so the link still points at a real wiki section, and keep `onTrack('topic', topic)` on the
  raw topic. Dedupe the rendered list by `(dataset, bucket)` so an item in two same-bucket datasets doesn't
  render duplicate chips.

### 4. Import on startup

- **[import-datasets.ts](src/lib/import-datasets.ts#L154)** — add `import_topic_buckets(filename)` mirroring
  `import_categories`: `ATTACH`, then `DELETE FROM main.topic_buckets` followed by
  `INSERT INTO main.topic_buckets (dataset, topic, bucket) SELECT dataset, topic, bucket FROM
  ref.topic_buckets`, then `DETACH`. DELETE-then-insert makes a re-run of the CLI authoritative (stale
  mappings don't linger); the `existsSync` guard means a missing file leaves existing mappings untouched.
- **[instrumentation.ts](src/instrumentation.ts#L41-L45)** — call `import_topic_buckets('topic_buckets.db')`
  in its own try/catch, after the dataset imports (order vs. categories doesn't matter).

### 5. Interactive CLI — `scripts/unify-topics.ts`

Modeled on [categorize.ts](scripts/categorize.ts) (plain `DatabaseSync`, no Wikipedia API needed). Uses
**`node:readline/promises`** (built-in — no new dependency). Add `"unify-topics": "tsx
scripts/unify-topics.ts"` to `package.json` scripts.

Flow:
1. Resolve `scrollsurf.db` via `process.env.SCROLLSURF_DATA_DIR ?? '.'` (mirrors [paths.ts](src/lib/paths.ts));
   read the authoritative universe: `SELECT dataset, topic, COUNT(*) n FROM item_topics GROUP BY dataset,
   topic ORDER BY topic, dataset` (this includes the hardcoded `Quotes` pair). Requires the app to have run
   once to populate `item_topics`.
2. Open/create `datasets/topic_buckets.db` with the `topic_buckets` table; load existing mappings and the
   current set of bucket names.
3. For each pair **not already mapped** (skip mapped unless `--all` is passed, so it's resumable/re-editable):
   - **Suggest** a bucket: exact normalized match (Capitalized, trim, strip non-alphanumeric) against existing
     buckets → that bucket; otherwise default the suggestion to the topic name itself. Also list existing
     buckets that are substring/near matches for quick numeric pick.
   - **Prompt** (readline): show `dataset / topic (n items)`, the suggestion, and a numbered list of existing
     buckets. Accept: `Enter` = suggestion, a number = that existing bucket, free text = new bucket, `s` =
     skip, `q` = quit.
   - **Persist immediately** via `INSERT OR REPLACE INTO topic_buckets` so the run is resumable mid-way; add
     freshly chosen names to the in-memory bucket set so later pairs can reuse them.

### 6. Tests

- **[affinity.test.ts](tests/lib/db/affinity.test.ts) / [feed.test.ts](tests/lib/db/feed.test.ts)** — existing
  cases use one dataset `D` with topics `X`/`Y`; under the dataset-qualified fallback they resolve to
  distinct buckets `D␟X`/`D␟Y`, so they keep passing. Add a case proving the **absence** of auto-merge: two
  datasets sharing topic name `History` with *no* mapping stay isolated (a like in one does not boost the
  other). Then add the merge case: insert `topic_buckets` rows assigning both to bucket `History` and verify
  the cross-dataset boost appears.
- **[tests/helpers/test-db.ts](tests/helpers/test-db.ts#L76-L83)** — add an optional helper to insert
  `topic_buckets` rows; topic insertion is unchanged.
- **[topics.test.ts](tests/lib/db/topics.test.ts), [articles.test.ts](tests/lib/db/articles.test.ts),
  [actions.test.ts](tests/actions.test.ts)** — update any assertions on exact `Topic` shape to include
  `bucket` (defaults to the topic name when unmapped).
- **E2e** — the seed has no `topic_buckets`, so chips render `bucket == topic`; visual snapshots are
  unchanged. No `test:e2e:update` expected.

## Verification

1. `npm run check` then `npm run check-fix`.
2. `npm test` — all unit suites green, including the new cross-dataset bucket cases.
3. CLI smoke: run the dev app once to populate `item_topics`, then `npm run unify-topics`; confirm it
   suggests buckets, accepts existing/new choices, writes `datasets/topic_buckets.db`, and is resumable on
   re-run (mapped pairs skipped without `--all`).
4. App check: with a `topic_buckets.db` that merges two synonyms, restart dev (`import_topic_buckets` runs),
   like a few items in one dataset's topic, and confirm the feed begins surfacing same-bucket items from
   *other* datasets; confirm cards show `[dataset] [bucket]`.
5. `npm run test:e2e` — snapshots unchanged.
