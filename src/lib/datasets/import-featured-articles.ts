import path from 'node:path';
import { existsSync } from 'node:fs';
import { db } from '../db';

const featured_db_path = path.join(process.cwd(), 'datasets', 'featured_articles.db');

export const import_featured_articles = () => {
  if (!existsSync(featured_db_path)) return;

  db.exec(`ATTACH '${featured_db_path}' AS featured`);

  try {
    db.exec(
      `INSERT OR IGNORE INTO main.articles (title, extract, url, description, image_url)
       SELECT title, extract, url, description, image_url FROM featured.articles`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.categories (name, hidden)
       SELECT DISTINCT name, hidden FROM featured.article_categories`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_categories (article_id, category_id)
       SELECT a.id, c.id
       FROM featured.article_categories fac
       JOIN main.articles a ON a.url = fac.url
       JOIN main.categories c ON c.name = fac.name`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_topics (article_id, dataset, topic)
       SELECT a.id, 'Featured', ft.topic
       FROM featured.article_topics ft
       JOIN main.articles a ON a.url = ft.url`
    );
    db.exec(
      `INSERT OR REPLACE INTO main.datasets (name, source_url)
       VALUES ('Featured', (SELECT value FROM featured.metadata WHERE key = 'source_url'))`
    );
  } finally {
    db.exec('DETACH featured');
  }
};
