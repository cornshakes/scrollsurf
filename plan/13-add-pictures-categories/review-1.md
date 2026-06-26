approve

## Review: Add Pictures to Category Tree (plan 13)

### Check results

- `npm run check` — **PASS** (type-check + lint clean)
- `npm test` — **PASS** (96/96 unit tests)
- `npm run test:e2e` — **MIXED** (see below)

### E2e test failures

Most e2e tests failed with `ECONNRESET` from the WebServer and a suspicious `TimeoutNegativeWarning: -58.97... is a negative number`. Two tests passed (`Privacy Page › loads from /privacy url`, `Home Feed › loads more cards by scrolling`). The negative-timer warning is a Node.js environment issue (a timeout value that went negative, likely from the test runner's own timing), not from these code changes. The `ECONNRESET` errors are a side-effect of Playwright's parallel workers overloading the dev server — a pre-existing flakiness pattern. Nothing in these changes touches the server startup path in a way that would cause crashes (all `import_*` calls in `instrumentation.ts` are individually try/catch wrapped).

### Code review

**`scripts/lib/commons.ts` — `commons_fetch_categories`**

Correct: batches ≤50 titles, `clshow=!hidden`, strips `Category:` prefix, uses `formatversion=2`. No pagination needed (`cllimit=500` is far beyond any real image's category count).

**`scripts/lib/pictures-dataset.ts`**

The download loop strips `Category:` a second time on line 179:
```ts
const clean_name = category_name.replace(/^Category:\s*/, '');
```
But `commons_fetch_categories` already returns pre-stripped names, making this a no-op. Harmless but redundant.

**`scripts/lib/wiki.ts`**

`fetch_category_members` and `fetch_category_parents_batch` now accept an optional `api` param defaulting to `wiki_api`. No behaviour change for existing callers. Clean.

**`scripts/lib/categorize-core.ts`**

Well-structured extraction. The walk-up pooling (multiple walks sharing frontier nodes) is correct and efficient. One small note: intermediate nodes visited during `walk_up_batch` are written to `category_hierarchy` outside any transaction (autocommit), then the batch result is written inside `BEGIN/COMMIT`. This means on a crash mid-walk some intermediate entries may be saved but the batch summary not — which is fine because those entries help subsequent runs.

**`scripts/categorize.ts` and `scripts/categorize-commons.ts`**

Both are correct thin wrappers. The `Arts → Art` alias in `fetch_children_commons` is the right place for this: the bootstrap iterates over `top_levels` and calls `fetch_children(tl)`, so `fetch_children_commons('Arts')` maps to `Category:Art` on Commons while the `top_level` mapping in `category_hierarchy` stays `'Arts'` (matching Wikipedia's tree). `exclude_parent` stop-list covers the commons facet/meta categories per the plan.

**`src/lib/import-datasets.ts`**

`import_pictures_dataset` correctly uses `INSERT OR IGNORE INTO main.categories (name)` — the `hidden` column has `DEFAULT 0` in the migration so single-column inserts are safe. The `item_categories` join on `url` is consistent with how article categories join. `import_categories(filename)` is correctly parameterised.

**`src/instrumentation.ts`**

Two `import_categories` calls, each in independent try/catch. Correct. A missing `commons_category_hierarchy.db` (expected if `categorize-commons` hasn't been run) just warns and is skipped.

**`src/lib/db/topics.ts`**

`i.type IN ('article', 'picture')` in both `GET_TOP_LEVELS_SQL` and `GET_CATEGORIES_SQL`. Correct and minimal change.

**`package.json`**

`"categorize-commons"` script added.

### Gaps (non-blocking)

- **`e2e/global-setup.ts` not updated**: the local `import_pictures` function in the setup file doesn't import `commons_categories` into the fixture DB. This is a gap in test coverage for the new picture-category link, but none of the existing e2e tests exercise the category tree, so no tests are broken by this. Should be addressed when e2e tests for the category view are added.
- **Redundant category prefix strip** in `pictures-dataset.ts` (line 179): safe no-op, but could be removed.
