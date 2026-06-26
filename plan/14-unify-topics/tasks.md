# Tasks: Dataset-independent topic buckets for affinity

## TOC

- [x] 1. Append schema migration v10 (`topic_buckets` table) [haiku]
- [x] 2. Add `bucket` field to `Topic` type [haiku]
- [x] 3. Rewrite affinity CTEs to group by bucket [sonnet]
- [x] 4. Add bucket to `fetch_topics_for_items` query [haiku]
- [x] 5. Update `CardTags.tsx` to display bucket and dedupe chips [sonnet]
- [x] 6. Add `import_topic_buckets` to `import-datasets.ts` [haiku]
- [x] 7. Call `import_topic_buckets` in `instrumentation.ts` [haiku]
- [x] 8. Write interactive CLI `scripts/unify-topics.ts` [sonnet]
- [x] 9. Register CLI in `package.json` scripts [haiku]
- [x] 10. Add `topic_buckets` helper to test-db.ts [haiku]
- [x] 11. Update existing tests to include `bucket` in `Topic` assertions [sonnet]
- [x] 12. Add new cross-dataset affinity/feed test cases [sonnet]

---

## 1. Append schema migration v10 (`topic_buckets` table) [haiku]

File: `src/lib/db/migrations.ts`

Append a new migration (do **not** edit existing ones). The migration adds the `topic_buckets` mapping table:

```sql
CREATE TABLE topic_buckets (
  dataset TEXT NOT NULL,
  topic   TEXT NOT NULL,
  bucket  TEXT NOT NULL,
  PRIMARY KEY (dataset, topic)
);
```

No `BEGIN/COMMIT` inside the migration body — the runner owns the transaction.

---

## 2. Add `bucket` field to `Topic` type [haiku]

File: `src/lib/db/types.ts`

Add `bucket: string` to the `Topic` interface. It holds the resolved bucket name — defaults to the topic name itself when no mapping exists.

---

## 3. Rewrite affinity CTEs to group by bucket [sonnet]

File: `src/lib/db/affinity.ts` (lines ~35–53)

Replace the current `topic_affinity` / `item_affinity` CTEs with three CTEs:

1. **`item_buckets AS MATERIALIZED`** — joins `item_topics` with `topic_buckets` (LEFT JOIN on `dataset, topic`); emits `(item_id, bucket)` where bucket is `COALESCE(tb.bucket, it.dataset || char(31) || it.topic)`. Use `SELECT DISTINCT` to avoid double-counting items that share a bucket via two datasets.

2. **`topic_affinity AS MATERIALIZED`** — groups by `ib.bucket` instead of `it.dataset, it.topic`; joins `user_items`, `item_buckets`, and `clicked` exactly as before but keyed on `bucket`.

3. **`item_affinity AS MATERIALIZED`** — joins `item_buckets` LEFT JOIN `topic_affinity` on `bucket`; groups by `ib.item_id`, averages `COALESCE(ta.affinity, 0.0)`.

No changes to `eligible_pool`, `pool_size`, the feed draw in `feed.ts`, `AFFINITY_STRENGTH`, or quote handling.

---

## 4. Add bucket to `fetch_topics_for_items` query [haiku]

File: `src/lib/db/topics.ts` (lines ~5–30)

In the `fetch_topics_for_items` SELECT:
- Add `LEFT JOIN topic_buckets tb ON tb.dataset = it.dataset AND tb.topic = it.topic` (after the existing `datasets` join).
- Add `COALESCE(tb.bucket, it.topic) AS bucket` to the selected columns.
- Map `bucket` into each returned `Topic` object.

---

## 5. Update `CardTags.tsx` to display bucket and dedupe chips [sonnet]

File: `src/components/CardTags.tsx` (lines ~82–114)

- Destructure `bucket` from each `Topic`.
- Set the topic `Chip` label to `bucket` instead of `topic`.
- Keep `href` pointing to the raw `topic` (so the link hits the real wiki section) and keep `onTrack('topic', topic)` on the raw topic name.
- Dedupe rendered chips by `(dataset, bucket)` — an item belonging to two same-bucket datasets must not render duplicate chips.
- The dataset chip is unchanged.

---

## 6. Add `import_topic_buckets` to `import-datasets.ts` [haiku]

File: `src/lib/import-datasets.ts` (near line 154, after `import_categories`)

Add a function `import_topic_buckets(filename: string)` mirroring the `import_categories` pattern:
1. Guard with `existsSync` — if the file is absent, log a warning and return (leaves existing mappings untouched).
2. `ATTACH` the reference DB as `ref`.
3. `DELETE FROM main.topic_buckets` then `INSERT INTO main.topic_buckets (dataset, topic, bucket) SELECT dataset, topic, bucket FROM ref.topic_buckets`.
4. `DETACH ref`.

DELETE-then-insert ensures a re-run of the CLI is authoritative and stale mappings don't linger.

---

## 7. Call `import_topic_buckets` in `instrumentation.ts` [haiku]

File: `src/instrumentation.ts` (near lines 41–45)

After the existing dataset imports, add:

```ts
try {
  import_topic_buckets('topic_buckets.db');
} catch (err) {
  console.warn('topic_buckets import failed', err);
}
```

Order relative to categories import doesn't matter.

---

## 8. Write interactive CLI `scripts/unify-topics.ts` [sonnet]

New file: `scripts/unify-topics.ts`

Modeled on `scripts/categorize.ts`. Uses `node:readline/promises` (built-in, no new dependency), plain `DatabaseSync`.

**Flow:**

1. Resolve `scrollsurf.db` from `process.env.SCROLLSURF_DATA_DIR ?? '.'`. Query the authoritative universe:
   ```sql
   SELECT dataset, topic, COUNT(*) AS n
   FROM item_topics
   GROUP BY dataset, topic
   ORDER BY topic, dataset
   ```
2. Open/create `datasets/topic_buckets.db` with the `topic_buckets` schema. Load existing mappings and the current set of known bucket names.
3. For each `(dataset, topic)` pair **not already mapped** (skip mapped pairs unless `--all` flag is passed — makes it resumable and re-editable):
   - **Suggest** a bucket: try an exact normalized match (lowercase, trim, strip non-alphanumeric) against existing bucket names → use that bucket; otherwise default the suggestion to the topic name itself. Also list existing buckets that are substring/near matches with a numeric index for quick pick.
   - **Prompt** via readline: display `dataset / topic (n items)`, the suggestion, and the numbered candidate list.
     - `Enter` → accept suggestion
     - A number → pick that existing bucket
     - Free text → create new bucket with that name
     - `s` → skip this pair (leave unmapped)
     - `q` → quit
   - **Persist immediately** via `INSERT OR REPLACE INTO topic_buckets` so the session is resumable if interrupted. Add freshly chosen names to the in-memory bucket set so later pairs can reference them.

---

## 9. Register CLI in `package.json` scripts [haiku]

File: `package.json`

Add one entry to `"scripts"`:

```json
"unify-topics": "tsx scripts/unify-topics.ts"
```

---

## 10. Add `topic_buckets` helper to test-db.ts [haiku]

File: `tests/helpers/test-db.ts` (near lines 76–83)

Add an optional helper function (e.g. `insert_topic_bucket(db, dataset, topic, bucket)`) that inserts a row into `topic_buckets`. Existing topic-insertion helpers are unchanged.

---

## 11. Update existing tests to include `bucket` in `Topic` assertions [sonnet]

Files:
- `tests/lib/db/topics.test.ts`
- `tests/lib/db/articles.test.ts`
- `tests/actions.test.ts`

Find all assertions on the shape of `Topic` objects and add `bucket` to the expected value. When no `topic_buckets` row exists for a pair, `bucket` should equal the `topic` name (the COALESCE fallback). No behavioral change — just shape completeness.

---

## 12. Add new cross-dataset affinity/feed test cases [sonnet]

Files: `tests/lib/db/affinity.test.ts`, `tests/lib/db/feed.test.ts`

**Isolation case** — two datasets (`D1`, `D2`) both have a topic named `History` but no `topic_buckets` mapping. A like on a `D1/History` item must **not** boost `D2/History` items (they resolve to distinct fallback buckets `D1␟History` vs `D2␟History`).

**Merge case** — insert `topic_buckets` rows assigning `D1/History` → `History` and `D2/History` → `History`. A like on a `D1/History` item **must** now boost `D2/History` items (they share bucket `History`).

Existing test cases use one dataset `D` with topics `X`/`Y`; their fallback buckets `D␟X` / `D␟Y` remain distinct, so they continue to pass without modification.
