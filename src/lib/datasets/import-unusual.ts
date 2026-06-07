import path from 'node:path';
import { existsSync } from 'node:fs';
import { db } from '../db';

const unusual_db_path = path.join(process.cwd(), 'datasets', 'unusual.db');

export const import_unusual_articles = () => {
  if (!existsSync(unusual_db_path)) return;

  db.exec(`ATTACH '${unusual_db_path}' AS unusual`);

  try {
    db.exec(
      `INSERT OR IGNORE INTO main.articles (title, extract, url, description, image_url)
       SELECT title, extract, url, description, image_url FROM unusual.articles`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.categories (name, hidden)
       SELECT DISTINCT name, hidden FROM unusual.article_categories`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_categories (article_id, category_id)
       SELECT a.id, c.id
       FROM unusual.article_categories uac
       JOIN main.articles a ON a.url = uac.url
       JOIN main.categories c ON c.name = uac.name`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_topics (article_id, dataset, topic)
       SELECT a.id, 'Unusual', ut.topic
       FROM unusual.article_topics ut
       JOIN main.articles a ON a.url = ut.url`
    );
    db.exec(
      `INSERT OR REPLACE INTO main.datasets (name, source_url)
       VALUES ('Unusual', (SELECT value FROM unusual.metadata WHERE key = 'source_url'))`
    );
  } finally {
    db.exec('DETACH unusual');
  }
};
