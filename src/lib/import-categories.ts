import path from 'node:path';
import { existsSync } from 'node:fs';
import { db } from './db';

const categories_db_path = path.join(process.cwd(), 'categories.db');

export const import_categories = () => {
  if (!existsSync(categories_db_path)) return;

  db.exec(`ATTACH '${categories_db_path}' AS categories`);

  try {
    db.exec(`
      BEGIN;

      INSERT OR IGNORE INTO main.category_hierarchy (category_name, top_level)
      SELECT category_name, top_level FROM categories.category_hierarchy;

      COMMIT;
    `);
  } finally {
    db.exec('DETACH categories');
  }
};
