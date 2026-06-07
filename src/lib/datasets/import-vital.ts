import path from 'node:path';
import { existsSync } from 'node:fs';
import { db } from '../db';

const vital_db_path = path.join(process.cwd(), 'datasets', 'vital_50000.db');

export const import_vital_articles = () => {
  if (!existsSync(vital_db_path)) return;

  db.exec(`ATTACH '${vital_db_path}' AS vital`);

  try {
    db.exec(
      `INSERT OR IGNORE INTO main.articles (title, extract, url, description, image_url)
       SELECT title, extract, url, description, image_url FROM vital.articles`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.categories (name, hidden)
       SELECT DISTINCT name, hidden FROM vital.article_categories`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_categories (article_id, category_id)
       SELECT a.id, c.id
       FROM vital.article_categories vac
       JOIN main.articles a ON a.url = vac.url
       JOIN main.categories c ON c.name = vac.name`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_topics (article_id, dataset, topic)
       SELECT a.id, 'Vital', vt.topic
       FROM vital.article_topics vt
       JOIN main.articles a ON a.url = vt.url`
    );
    db.exec(
      `INSERT OR REPLACE INTO main.datasets (name, source_url)
       VALUES ('Vital', (SELECT value FROM vital.metadata WHERE key = 'source_url'))`
    );
  } finally {
    db.exec('DETACH vital');
  }
};
