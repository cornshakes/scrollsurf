import path from 'node:path';
import { existsSync } from 'node:fs';
import { db } from './db';

const dataset_path = (filename: string) => path.join(process.cwd(), 'datasets', filename);

// Imports one reference DB (built by a download-* script) into scrollsurf.db via
// ATTACH + bulk INSERT OR IGNORE. The grouping label (e.g. 'Vital'), stored on
// each article_topics row, comes from the reference DB's own metadata table.
// All four article datasets share this shape.
export const import_articles_dataset = (filename: string) => {
  const ref_path = dataset_path(filename);
  if (!existsSync(ref_path)) {
    return;
  }

  db.exec(`ATTACH '${ref_path}' AS ref`);
  try {
    const row = db.prepare("SELECT value FROM ref.metadata WHERE key = 'title'").get() as
      | { value: string }
      | undefined;
    if (!row) {
      throw new Error(`${filename}: no 'title' key in metadata`);
    }
    const dataset = row.value.replace(/'/g, "''"); // escape for SQL interpolation below

    db.exec(
      `INSERT OR IGNORE INTO main.articles (title, extract, url, description, image_url)
       SELECT title, extract, url, description, image_url FROM ref.articles`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.categories (name, hidden)
       SELECT DISTINCT name, hidden FROM ref.article_categories`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_categories (article_id, category_id)
       SELECT a.id, c.id
       FROM ref.article_categories rac
       JOIN main.articles a ON a.url = rac.url
       JOIN main.categories c ON c.name = rac.name`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.article_topics (article_id, dataset, topic)
       SELECT a.id, '${dataset}', rt.topic
       FROM ref.article_topics rt
       JOIN main.articles a ON a.url = rt.url`
    );
    db.exec(
      `INSERT OR REPLACE INTO main.datasets (name, source_url)
       VALUES ('${dataset}', (SELECT value FROM ref.metadata WHERE key = 'source_url'))`
    );
  } finally {
    db.exec('DETACH ref');
  }
};

export const import_pictures_dataset = (filename: string) => {
  const ref_path = dataset_path(filename);
  if (!existsSync(ref_path)) {
    return;
  }

  db.exec(`ATTACH '${ref_path}' AS ref`);
  try {
    const row = db.prepare("SELECT value FROM ref.metadata WHERE key = 'title'").get() as
      | { value: string }
      | undefined;
    if (!row) {
      throw new Error(`${filename}: no 'title' key in metadata`);
    }
    const dataset = row.value.replace(/'/g, "''");

    db.exec(
      `INSERT OR IGNORE INTO main.pictures (title, url, image_url, credit)
       SELECT file_title, url, image_url, credit FROM ref.pictures`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.picture_topics (picture_id, dataset, topic)
       SELECT p.id, '${dataset}', rpt.topic
       FROM ref.picture_topics rpt
       JOIN main.pictures p ON p.url = rpt.url`
    );
    db.exec(
      `INSERT OR REPLACE INTO main.datasets (name, source_url)
       VALUES ('${dataset}', (SELECT value FROM ref.metadata WHERE key = 'source_url'))`
    );
  } finally {
    db.exec('DETACH ref');
  }
};

export const import_categories = () => {
  const ref_path = dataset_path('categories.db');
  if (!existsSync(ref_path)) {
    return;
  }

  db.exec(`ATTACH '${ref_path}' AS ref`);
  try {
    db.exec(
      `INSERT OR IGNORE INTO main.category_hierarchy (category_name, top_level)
       SELECT category_name, top_level FROM ref.category_hierarchy`
    );
  } finally {
    db.exec('DETACH ref');
  }
};
