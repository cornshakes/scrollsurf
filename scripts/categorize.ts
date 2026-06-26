import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import { run_categorize, TOP_LEVELS } from './lib/categorize-core';
import { fetch_category_members, fetch_category_parents_batch } from './lib/wiki';

const get_all_dataset_categories = (): Set<string> => {
  const datasets_dir = path.join(process.cwd(), 'datasets');
  const dbs = readdirSync(datasets_dir).filter((f) => f.endsWith('.db') && f !== 'categories.db');

  const all_categories = new Set<string>();
  for (const file of dbs) {
    const db = new DatabaseSync(path.join(datasets_dir, file));
    try {
      const rows = db
        .prepare('SELECT DISTINCT name FROM article_categories WHERE hidden = 0')
        .all() as { name: string }[];
      for (const row of rows) all_categories.add(row.name);
    } catch {
      // skip DBs without article_categories
    } finally {
      db.close();
    }
  }
  return all_categories;
};

const main = async () => {
  await run_categorize({
    db_path: path.join(process.cwd(), 'datasets', 'categories.db'),
    top_levels: TOP_LEVELS,
    fetch_children: (category: string) => fetch_category_members(category, { type: 'subcat' }),
    fetch_parents_batch: (categories: string[]) => fetch_category_parents_batch(categories),
    read_source_categories: get_all_dataset_categories,
  });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
