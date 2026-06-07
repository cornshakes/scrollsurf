import path from 'node:path';
import { existsSync } from 'node:fs';
import { db } from '../db';

const good_db_path = path.join(process.cwd(), 'datasets', 'good_articles.db');

export const import_good_articles = () => {
  if (!existsSync(good_db_path)) return;

  db.exec(`ATTACH '${good_db_path}' AS good`);

  try {
    db.exec(
      `INSERT OR IGNORE INTO main.articles (title, extract, url, description, image_url)
       SELECT title, extract, url, description, image_url FROM good.articles`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.categories (name, hidden)
       SELECT DISTINCT name, hidden FROM good.article_categories`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_categories (article_id, category_id)
       SELECT a.id, c.id
       FROM good.article_categories gac
       JOIN main.articles a ON a.url = gac.url
       JOIN main.categories c ON c.name = gac.name`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_topics (article_id, dataset, topic)
       SELECT a.id, 'Good', gt.topic
       FROM good.article_topics gt
       JOIN main.articles a ON a.url = gt.url`
    );
    db.exec(
      `INSERT OR REPLACE INTO main.datasets (name, source_url)
       VALUES ('Good', (SELECT value FROM good.metadata WHERE key = 'source_url'))`
    );
  } finally {
    db.exec('DETACH good');
  }
};
