# Tasks: Add Pictures to Category Tree

## TOC

- [x] 1. Add `commons_categories` table to pictures reference DB schema [haiku]
- [x] 2. Add `commons_fetch_categories` to `scripts/lib/commons.ts` [haiku]
- [x] 3. Generalize wiki.ts category helpers to accept an api client param [haiku]
- [x] 4. Wire both picture download scripts to call `fetch_categories` [haiku]
- [x] 5. Extract `scripts/lib/categorize-core.ts` from `scripts/categorize.ts` [sonnet]
- [x] 6. Slim down `scripts/categorize.ts` to a thin wrapper [haiku]
- [x] 7. Create `scripts/categorize-commons.ts` with stop-list + add npm script [sonnet]
- [x] 8. Update import layer: picture categories + parameterize `import_categories` [haiku]
- [x] 9. Update `src/instrumentation.ts` to import both hierarchy DBs [haiku]
- [x] 10. Update `src/lib/db/topics.ts` to include pictures in category queries [haiku]

---

## 1. Add `commons_categories` table to pictures reference DB schema

**File:** `scripts/lib/pictures-dataset.ts`

In `open_pictures_db`, add a new table to the schema:

```sql
CREATE TABLE IF NOT EXISTS commons_categories (
  url  TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (url, name)
);
```

Add `fetch_categories?: (file_titles: string[]) => Promise<Map<string, string[]>>` to `DownloadPicturesOptions`.

In the Phase 2 download loop, after `fetch_image_info`, if `fetch_categories` is provided: call it for the batch and `INSERT OR IGNORE` into `commons_categories` — keyed by the picture's `descriptionurl` (same `url` key used by `picture_topics`). Strip the `Category:` prefix from all category names; skip hidden/maintenance categories (those are already filtered via `clshow=!hidden` in the fetcher).

---

## 2. Add `commons_fetch_categories` to `scripts/lib/commons.ts`

**File:** `scripts/lib/commons.ts`

Add a new exported function `commons_fetch_categories(file_titles: string[]): Promise<Map<string, string[]>>`.

- Use `commons_api` with `prop=categories`, `clshow=!hidden`, `cllimit=500`.
- Batch ≤ 50 titles per API call (mirrors `fetch_category_parents_batch`).
- Returns a `Map<file_title, string[]>` of raw category names (strip the `Category:` prefix).

---

## 3. Generalize wiki.ts category helpers to accept an api client param

**File:** `scripts/lib/wiki.ts`

`fetch_category_members` and `fetch_category_parents_batch` currently call `wiki_api` directly. Add an optional `api` parameter (defaulting to `wiki_api`) to each so Commons can reuse them with `commons_api`.

Signature change example:
```ts
const fetch_category_members = async (
  category: string,
  api = wiki_api,
): Promise<string[]>
```

No behavior change for existing callers — the default keeps the article graph working as before.

---

## 4. Wire both picture download scripts to call `fetch_categories`

**Files:**
- `scripts/datasets/download-featured-pictures.ts`
- `scripts/datasets/download-commons-featured-pictures.ts`

Import `commons_fetch_categories` from `scripts/lib/commons.ts` and pass it as `fetch_categories: commons_fetch_categories` in the options object passed to the download pipeline. The ~57 en.wp-only files in `featured_pictures.db` will simply return no categories from Commons — that is expected and fine.

---

## 5. Extract `scripts/lib/categorize-core.ts` from `scripts/categorize.ts`

**New file:** `scripts/lib/categorize-core.ts`

Extract the graph-agnostic walk-up engine from `scripts/categorize.ts` into a reusable `run_categorize` function. The engine includes: `TOP_LEVELS`, `walk_up_batch`, the bootstrap phase, and the main categorize loop.

Parameterize via an options object:

```ts
interface RunCategorizeOptions {
  db_path: string;
  top_levels: string[];
  fetch_children: (category: string) => Promise<string[]>;
  fetch_parents_batch: (categories: string[]) => Promise<Map<string, string[]>>;
  read_source_categories: () => Set<string>;
  exclude_parent?: (name: string) => boolean;
}

const run_categorize = async (opts: RunCategorizeOptions): Promise<void>
```

The `category_hierarchy` and `bootstrap_*` tables live in `db_path`, so each graph keeps its own bootstrap cache. The `exclude_parent` predicate (when provided) filters out unwanted parents during the walk — return `true` to skip a parent. Default is `undefined` (no filtering).

---

## 6. Slim down `scripts/categorize.ts` to a thin wrapper

**File:** `scripts/categorize.ts`

Replace the current implementation with a thin wrapper that calls `run_categorize` from `categorize-core.ts`:

- `fetch_children` → `fetch_category_members` with `wiki_api`
- `fetch_parents_batch` → `fetch_category_parents_batch` with `wiki_api`
- `read_source_categories` → current `get_all_dataset_categories` (distinct `article_categories.name WHERE hidden = 0`)
- `db_path` → `datasets/categories.db`
- No `exclude_parent` (article graph doesn't need the stop-list)

Behavior must be identical to the original.

---

## 7. Create `scripts/categorize-commons.ts` with stop-list + add npm script

**New file:** `scripts/categorize-commons.ts`

Thin wrapper over `run_categorize` for the Commons graph:

- `fetch_children` → `fetch_category_members` with `commons_api`
- `fetch_parents_batch` → `fetch_category_parents_batch` with `commons_api`
- `read_source_categories` → query distinct `commons_categories.name` across all picture dataset DBs (`featured_pictures.db`, `commons_featured_pictures.db`)
- `db_path` → `datasets/commons_category_hierarchy.db`
- `top_levels` → same 34 names as the article run, **except** seed `"Arts"` from Commons `Category:Art` (bootstrap alias: the bootstrap phase must treat `"Arts"` as mapping to `"Art"` on Commons)
- `exclude_parent` → return `true` for names matching (case-insensitive): `by year|by decade|by century|by month|by day|by country|by location|by name|by date|Media types|CommonsRoot|^Topics$|Categories by|maintenance|needing`

**`package.json`:** add `"categorize-commons": "tsx --env-file=scripts/.env scripts/categorize-commons.ts"` to the `scripts` section.

---

## 8. Update import layer: picture categories + parameterize `import_categories`

**File:** `src/lib/import-datasets.ts`

**`import_pictures_dataset`:** after the existing topics import, add category import mirroring `import_articles_dataset` (pictures have no `hidden` flag, treat as 0):

```sql
INSERT OR IGNORE INTO main.categories (name)
  SELECT DISTINCT name FROM ref.commons_categories;

INSERT OR IGNORE INTO main.item_categories (item_id, category_id)
  SELECT i.id, c.id
  FROM ref.commons_categories rcc
  JOIN main.items i ON i.url = rcc.url
  JOIN main.categories c ON c.name = rcc.name;
```

**`import_categories`:** change the signature from `import_categories()` to `import_categories(filename: string)` and use the parameter instead of the hardcoded `'categories.db'`. The rest of the function stays the same.

---

## 9. Update `src/instrumentation.ts` to import both hierarchy DBs

**File:** `src/instrumentation.ts`

Update the call site of `import_categories` to pass the filename explicitly, and add a second call for the Commons hierarchy:

```ts
import_categories('categories.db');
import_categories('commons_category_hierarchy.db');
```

Both calls go through the same try/catch — a missing DB warns and is skipped.

---

## 10. Update `src/lib/db/topics.ts` to include pictures in category queries

**File:** `src/lib/db/topics.ts`

In `GET_TOP_LEVELS_SQL` and `GET_CATEGORIES_SQL`, change:

```sql
WHERE i.type = 'article'
```

to:

```sql
WHERE i.type IN ('article', 'picture')
```

This is the only change needed. Leave field names (`article_count` etc.) as-is unless types.ts and CategoryFeed are also being updated — scope is SQL filter only.
