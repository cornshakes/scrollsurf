# Remove Dataset Selection

## Context

The "Datasets" view (`TopicsFeed` in `src/components/DatasetsTopicsFeed.tsx`) shows the dataset → topic tree and lets users toggle datasets on/off. Toggles are stored per-user in `user_settings (user_id, dataset, enabled)`, and both feed queries (`get_next_articles`, `get_next_pictures`) filter candidates to enabled datasets. This per-user selection capability is being removed: everybody gets all datasets, always. The page goes away entirely.

**Stays (explicitly out of scope):**
- The dataset/topic chips on article cards (`ArticleCard.tsx`) — they are display + source links, not selection. Therefore the `datasets (name, source_url)` table, its import code in `src/lib/import-datasets.ts`, the `dataset_url` field on `Article.topics`, and `'dataset'` in `LinkType` / click tracking all stay.
- The Categories view and `get_category_tree` — unrelated to dataset selection.
- The `EXISTS (… FROM article_topics/picture_topics …)` has-a-topic filter in feed SQL — today an item with no topic rows is excluded; keep that behavior, only drop the `user_settings` part.

## Step 1 — UI

- **Delete** `src/components/DatasetsTopicsFeed.tsx` (entire datasets/topics page component).
- **Edit** `src/components/WikiArticles.tsx`: remove the `TopicsFeed` import, drop `'datasets'` from the `View` union, remove `datasets: 'Datasets'` from `VIEW_LABELS`, remove the `{view === 'datasets' && <TopicsFeed />}` render.

## Step 2 — Server actions (`src/app/actions.ts`)

Delete `get_wiki_topic_tree`, `set_wiki_dataset_enabled`, `get_wiki_datasets_enabled` and their now-unused imports (`get_topic_tree`, `set_dataset_enabled`, `get_datasets_enabled`, `type TopicTree`).

## Step 3 — DB layer

- **Delete** `src/lib/db/settings.ts` (`set_dataset_enabled` / `get_datasets_enabled`).
- **Edit** `src/lib/db/topics.ts`: remove `get_topic_tree` and its SQL constants (`GET_DATASETS_SQL`, `GET_PICTURE_DATASET_SQL`, `GET_PICTURE_TOPICS_SQL`, `GET_TOPICS_SQL`). Keep `get_category_tree` and its SQL.
- **Edit** `src/lib/db/index.ts`: drop the `./settings` export line and the `get_topic_tree`, `DatasetGroup`, `TopicTree` exports. Keep `TopicStat` (used by `CategoryGroup`).
- **Edit** `src/lib/db/types.ts`: remove `DatasetGroup` and `TopicTree`. Keep `TopicStat`, `CategoryGroup`, `CategoryTree`, and keep `'dataset'` in `LinkType` (chips still record clicks).

## Step 4 — Schema (`src/lib/db/connection.ts`)

- Remove the `user_settings` CREATE TABLE block. Keep the `datasets` table.
- Add `DROP TABLE IF EXISTS user_settings;` to the schema setup so existing runtime DBs are cleaned up (there is no migration system; the schema block is the place state lives).

## Step 5 — Feed queries

In `src/lib/db/articles.ts` (`ARTICLE_GET_NEXT_SQL`) and `src/lib/db/pictures.ts` (`PICTURE_GET_NEXT_SQL`), simplify the EXISTS subquery by removing the `LEFT JOIN user_settings us …` and `AND COALESCE(us.enabled, 1) = 1` lines, keeping the has-a-topic check, e.g. for articles:

```sql
AND EXISTS (
  SELECT 1 FROM article_topics at
  WHERE at.article_id = a.id
)
```

Affinity CTEs/weighting are untouched.

## Step 6 — Tests

- **Delete** `tests/lib/db/settings.test.ts` and `e2e/tests/datasets.spec.ts`.
- **Edit** `tests/lib/db/topics.test.ts`: remove the four `get_topic_tree` tests and its import; keep all `get_category_tree` tests.
- **Edit** `tests/lib/db/articles.test.ts`: remove the two disabled-dataset tests ("excludes articles from a disabled dataset", "disabled dataset does not affect other users") and the `set_dataset_enabled` import.
- **Edit** `e2e/helpers/pages.ts`: drop `'datasets'` from the `View` type (keep `'dataset'` in the link_type union — card chips remain).
- `e2e/tests/clicks.spec.ts` stays unchanged: it tests dataset-chip clicks on feed cards, which remain.

## Step 7 — Docs (`CLAUDE.md`)

In the Topics section: remove the "User preferences for dataset inclusion are stored in `user_settings`…" paragraph, and reword the sentence describing the topics page / `get_topic_tree` / `DatasetGroup[]` since they no longer exist (the dataset → topic grouping itself still exists in `article_topics`).

## Verification

1. Type-check (`npx tsc --noEmit` or the project's check script), then `npm run lint-fix` (per CLAUDE.md).
2. `grep -rn "user_settings\|dataset_enabled\|get_topic_tree\|TopicTree\|DatasetGroup" src tests e2e` → no hits.
3. `npm test` — remaining suites pass (articles/pictures feed tests, category tests, actions tests).
4. E2E suite — passes without `datasets.spec.ts`; `clicks.spec.ts` still green.
5. Manual: `npm run dev` against an existing `scrollsurf.db` that has `user_settings` rows — startup drops the table, feed serves items from all datasets, nav shows no "Datasets" entry, dataset chips on cards still link to their Wikipedia source pages.
