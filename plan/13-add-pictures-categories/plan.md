Ready for review
Select text to add comments on the plan
Categorize pictures into top-level categories
Context
The category browser (CategoryFeed / get_category_tree) maps Wikipedia articles to 34 top-level categories via datasets/categories.db, built by npm run categorize. Pictures and quotes are excluded — they have no category data, so they never appear in the top-level category tree. The goal is to bring pictures into the top-level tree. Quotes stay topic-only.

Key discovery that shapes the design
Both picture datasets are essentially Commons-hosted, even the "Wikipedia" featured pictures:

featured_pictures.db: 8311 / 8368 pictures have their description page on commons.wikimedia.org (only 57 are truly en.wikipedia-hosted).
commons_featured_pictures.db: all Commons.
So picture categories are Commons categories, which live in a category graph separate from en.wikipedia's. The existing categorize.ts walk-up only traverses the en.wikipedia graph (wiki_api).

Decisions (confirmed with user)
Pictures → separate Commons category tree. Build a parallel walk-up over the Commons category graph (commons_api), reusing the same 34 top-level names so pictures land in the same browse tree as articles (one unified top-level set; the "separate tree" is separate only at build time — separate graph traversal + separate bootstrap cache — and merges into one category_hierarchy for querying). Applies to both picture datasets, since both are Commons-hosted.
Quotes stay topic-only. No categories. No changes to the quote pipeline.
Are Commons' top-levels the same as Wikipedia's? (verified)
Probed via the Commons API (prop=categoryinfo): all 34 Wikipedia top-level names exist as categories on Commons, and 33 of 34 have subcategories — so reusing the same 34 names is viable and keeps one unified tree. Commons' own Category:Topics is organized by meta-facets ("by century", "by location", …), not a clean subject vocabulary, so a Commons-native top-level set would be worse.

One exception: Arts has subcats=0 on Commons (Commons uses the singular Art). So the Commons walk-up must seed top-level "Arts" from Commons Category:Art (an alias in the Commons bootstrap only). All other 33 seed directly from the same-named Commons category.

Design overview
download-*-pictures → commons_categories (Commons cat names) in *_pictures.db
        │
categorize-commons.ts → walk up Commons graph → datasets/commons_categories.db
        │
import (instrumentation startup):
   import_pictures_dataset → categories + item_categories
   import_categories(categories.db)          (existing, articles)
   import_categories(commons_categories.db)  (new, pictures)
        │
get_category_tree query now counts type IN ('article','picture')
Changes
1. Reference DB schema + picture download pipeline
scripts/lib/pictures-dataset.ts

Add a commons_categories table to open_pictures_db schema:
CREATE TABLE IF NOT EXISTS commons_categories (
  url  TEXT NOT NULL,
  name TEXT NOT NULL,
  PRIMARY KEY (url, name)
);
Add fetch_categories?: (file_titles: string[]) => Promise<Map<string, string[]>> to DownloadPicturesOptions (file_title → Commons category names).
In the Phase 2 download loop, after fetch_image_info, call fetch_categories for the batch and INSERT OR IGNORE rows into commons_categories keyed by the picture's descriptionurl (same url key used by picture_topics). Strip the Category: prefix; skip hidden/maintenance categories.
scripts/lib/commons.ts — add the category fetcher (Commons is authoritative for both datasets' files):

commons_fetch_categories(file_titles) using commons_api, prop=categories, clshow=!hidden, cllimit=500, batched ≤50 titles per call (mirrors fetch_category_parents_batch). Returns Map<file_title, string[]>.
Wire both download scripts to pass fetch_categories: commons_fetch_categories:

scripts/datasets/download-commons-featured-pictures.ts
scripts/datasets/download-featured-pictures.ts (its files are Commons-hosted too, so it also uses the Commons fetcher; the ~57 en.wp-only files simply return no categories).
Per the download-once / no-backfill policy, this is a pipeline feature, not a repair: delete datasets/featured_pictures.db and datasets/commons_featured_pictures.db and re-run the download scripts to populate picture_categories.

2. Shared categorize core + Commons walk-up
Refactor to avoid duplicating the walk-up/bootstrap logic across two graphs.

New scripts/lib/categorize-core.ts — extract the graph-agnostic engine from scripts/categorize.ts (TOP_LEVELS, walk_up_batch, bootstrap, categorize loop). Parameterize via an options object:

run_categorize({
  db_path,                 // datasets/categories.db | datasets/commons_categories.db
  top_levels,              // shared 34 names
  fetch_children,          // (category) => Promise<string[]>   subcats
  fetch_parents_batch,     // (categories) => Promise<Map<string,string[]>>
  read_source_categories,  // () => Set<string>  raw category names to map
})
The category_hierarchy / bootstrap_* tables live in the passed db_path, so each graph keeps its own bootstrap cache.

Generalize the two graph helpers in scripts/lib/wiki.ts to accept an api client (default wiki_api): fetch_category_members and fetch_category_parents_batch. Commons reuses them with commons_api.

scripts/categorize.ts becomes a thin wrapper: wiki_api fetchers + read_source_categories = current get_all_dataset_categories (distinct article_categories.name WHERE hidden = 0) + datasets/categories.db.

New scripts/categorize-commons.ts — wrapper: commons_api fetchers + read_source_categories = distinct commons_categories.name across dataset DBs + output datasets/commons_category_hierarchy.db (named distinctly from the per-picture commons_categories table to avoid confusion). Seed top-level "Arts" from Commons Category:Art (see Decisions); all other 33 seed from their same-named Commons category. Add npm run categorize-commons to package.json (tsx --env-file=scripts/.env scripts/categorize-commons.ts).

Fan-out control (verified by smoke test). Walking up the Commons graph fans out more than Wikipedia's because Commons categories have many meta/facet parents. A smoke test over 64 real picture categories resolved 63/64 at ~1.4 parent-fetch API calls each (pooling bounds cost), but the frontier peaked near ~1k nodes with only a shallow seed. Two mitigations, both in categorize-core.ts:

Keep the existing depth-2 bootstrap (same as the article run) — it is what makes walks terminate in a few hops; do not skip it for the Commons graph.
Add a parent stop-list filter applied in the walk: drop parents that are Commons maintenance/facet categories so walks neither fan out through them nor mis-resolve via an irrelevant facet. Skip names matching e.g. by year|by decade|by century|by month|by day|by country|by location|by name| by date|Media types|CommonsRoot|^Topics$|Categories by|maintenance|needing (case-insensitive). Expose this as an optional exclude_parent? predicate on run_categorize (default none for the en.wp/article graph, set for Commons).
3. Import layer (src/lib/import-datasets.ts)
import_pictures_dataset: add category import mirroring import_articles_dataset (pictures have no hidden flag → default 0):
INSERT OR IGNORE INTO main.categories (name) SELECT DISTINCT name FROM ref.commons_categories;
INSERT OR IGNORE INTO main.item_categories (item_id, category_id)
  SELECT i.id, c.id FROM ref.commons_categories rcc
  JOIN main.items i ON i.url = rcc.url
  JOIN main.categories c ON c.name = rcc.name;
import_categories: parameterize as import_categories(filename) and call it for both categories.db and commons_category_hierarchy.db. Update the caller in src/instrumentation.ts. (Merge into the same category_hierarchy table; category_name is PK, so same-named en.wp/Commons categories collapse to the first-imported mapping — acceptable, they map similarly.)
4. Query layer (src/lib/db/topics.ts)
In GET_TOP_LEVELS_SQL and GET_CATEGORIES_SQL, change the item filter from i.type = 'article' to i.type IN ('article', 'picture') so pictures are counted in the top-level tree. (Leave the article_count field names as-is to limit churn, or rename to item_count in types.ts + CategoryFeed if preferred.)

Critical files
scripts/lib/pictures-dataset.ts — schema + category fetch phase
scripts/lib/commons.ts — commons_fetch_categories
scripts/lib/wiki.ts — api param on the two category helpers
scripts/lib/categorize-core.ts (new) — shared engine
scripts/categorize.ts (slim down) + scripts/categorize-commons.ts (new)
src/lib/import-datasets.ts — picture category import (ref.commons_categories) + import_categories(filename)
src/instrumentation.ts — import both hierarchy DBs
src/lib/db/topics.ts — include 'picture' in the tree queries
package.json — categorize-commons script
Verification
Regenerate data (download-once policy):
rm datasets/featured_pictures.db datasets/commons_featured_pictures.db
npm run download-featured-pictures && npm run download-commons-featured-pictures
Spot-check: sqlite3 datasets/featured_pictures.db "SELECT COUNT(*) FROM commons_categories;" is well above zero.
Build Commons tree: npm run categorize-commons, then check datasets/commons_category_hierarchy.db category_hierarchy row count and the mapped-vs-failed ratio printed by the run (coverage is the main risk for the Commons graph — confirm it's reasonable, and that "Arts" maps via the Art alias). Watch the run's progress: with depth-2 bootstrap + the stop-list, per-batch walks should resolve in a few rounds, not balloon — if fan-out looks excessive, tighten the exclude_parent stop-list. (A standalone fan-out smoke test already validated the approach.)
npm run check (type-check + lint), then npm run check-fix.
End-to-end: start the app so instrumentation.ts re-imports into a fresh scrollsurf.db; confirm get_category_tree returns picture counts — e.g. via a unit test in tests/ over topics.ts, or query SELECT top_level, COUNT(*) FROM category_hierarchy ch JOIN categories c ON c.name=ch.category_name JOIN item_categories ic ON ic.category_id=c.id JOIN items i ON i.id=ic.item_id WHERE i.type='picture' GROUP BY top_level;.
Run npm test (covers src/lib/db/*, including the modified topics.ts).