import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { run_categorize, TOP_LEVELS } from './lib/categorize-core';
import { fetch_category_members, fetch_category_parents_batch } from './lib/wiki';
import { commons_api } from './lib/commons';

const PICTURE_DATASETS = ['featured_pictures.db', 'commons_featured_pictures.db'];

// Commons uses Category:Art (singular), not Category:Arts
const fetch_children_commons = (category: string): Promise<string[]> =>
  fetch_category_members(
    category === 'Arts' ? 'Art' : category,
    { type: 'subcat' },
    undefined,
    commons_api
  );

const fetch_parents_commons = (categories: string[]): Promise<Map<string, string[]>> =>
  fetch_category_parents_batch(categories, commons_api);

const EXCLUDE_RE =
  /by year|by decade|by century|by month|by day|by country|by location|by name|by date|media types|commonsroot|^topics$|categories by|maintenance|needing/i;

const exclude_parent = (name: string): boolean => EXCLUDE_RE.test(name);

const read_source_categories = (): Set<string> => {
  const datasets_dir = path.join(process.cwd(), 'datasets');
  const all_categories = new Set<string>();

  for (const file of PICTURE_DATASETS) {
    const db_file = path.join(datasets_dir, file);
    if (!existsSync(db_file)) {
      console.warn(`[categorize-commons] skipping missing DB: ${file}`);
      continue;
    }
    const db = new DatabaseSync(db_file);
    try {
      const rows = db.prepare('SELECT DISTINCT name FROM commons_categories').all() as {
        name: string;
      }[];
      for (const row of rows) {
        all_categories.add(row.name);
      }
    } catch (err) {
      console.warn(`[categorize-commons] could not read commons_categories from ${file}:`, err);
    } finally {
      db.close();
    }
  }

  return all_categories;
};

const main = async () => {
  await run_categorize({
    db_path: path.join(process.cwd(), 'datasets', 'commons_category_hierarchy.db'),
    top_levels: TOP_LEVELS,
    fetch_children: fetch_children_commons,
    fetch_parents_batch: fetch_parents_commons,
    read_source_categories,
    exclude_parent,
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
