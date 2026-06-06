import path from 'node:path';
import { existsSync } from 'node:fs';
import { db } from './db';

const vital_db_path = path.join(process.cwd(), 'vital_50000.db');

export const import_vital_articles = () => {
  if (!existsSync(vital_db_path)) return;

  db.exec(`ATTACH '${vital_db_path}' AS vital`);

  try {
    db.exec(`
      BEGIN;

      INSERT OR IGNORE INTO main.articles (title, extract, url, description, image_url)
      SELECT title, extract, url, description, image_url FROM vital.articles;

      INSERT OR IGNORE INTO main.categories (name, hidden)
      SELECT DISTINCT name, hidden FROM vital.article_categories;

      INSERT OR IGNORE INTO main.article_categories (article_id, category_id)
      SELECT a.id, c.id
      FROM vital.article_categories vac
      JOIN main.articles a ON a.url = vac.url
      JOIN main.categories c ON c.name = vac.name;

      INSERT OR IGNORE INTO main.article_topics (article_id, topic)
      SELECT a.id, vt.topic
      FROM vital.article_vital_topics vt
      JOIN main.articles a ON a.url = vt.url;

      COMMIT;
    `);
  } finally {
    db.exec('DETACH vital');
  }
};
