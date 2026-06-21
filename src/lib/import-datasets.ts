import { existsSync } from 'node:fs';
import { db } from './db';
import { dataset_path } from './paths';

// Imports one reference DB (built by a download-* script) into scrollsurf.db via
// ATTACH + bulk INSERT OR IGNORE. The grouping label (e.g. 'Vital'), stored on
// each item_topics row, comes from the reference DB's own metadata table.
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
      `INSERT OR IGNORE INTO main.items (type, title, url)
       SELECT 'article', title, url FROM ref.articles`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.articles (item_id, extract, description, image_url)
       SELECT i.id, ra.extract, ra.description, ra.image_url
       FROM ref.articles ra
       JOIN main.items i ON i.url = ra.url`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.categories (name, hidden)
       SELECT DISTINCT name, hidden FROM ref.article_categories`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.item_categories (item_id, category_id)
       SELECT i.id, c.id
       FROM ref.article_categories rac
       JOIN main.items i ON i.url = rac.url
       JOIN main.categories c ON c.name = rac.name`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.item_topics (item_id, dataset, topic)
       SELECT i.id, '${dataset}', rt.topic
       FROM ref.article_topics rt
       JOIN main.items i ON i.url = rt.url`
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
      `INSERT OR IGNORE INTO main.items (type, title, url)
       SELECT 'picture', p.file_title, p.url FROM ref.pictures p`
    );
    db.exec(
      `INSERT INTO main.pictures (item_id, image_url, caption, credit)
       SELECT i.id, p.image_url, COALESCE(d.caption, ''), p.credit
       FROM ref.pictures p
       LEFT JOIN ref.discovered_pictures d ON d.file_title = p.file_title
       JOIN main.items i ON i.url = p.url
       ON CONFLICT(item_id) DO UPDATE SET caption = excluded.caption
       WHERE main.pictures.caption = ''`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.item_topics (item_id, dataset, topic)
       SELECT i.id, '${dataset}', rpt.topic
       FROM ref.picture_topics rpt
       JOIN main.items i ON i.url = rpt.url`
    );
    db.exec(
      `INSERT OR REPLACE INTO main.datasets (name, source_url)
       VALUES ('${dataset}', (SELECT value FROM ref.metadata WHERE key = 'source_url'))`
    );
  } finally {
    db.exec('DETACH ref');
  }
};

export const import_quotes_dataset = (filename: string) => {
  const ref_path = dataset_path(filename);
  if (!existsSync(ref_path)) {
    return;
  }

  db.exec(`ATTACH '${ref_path}' AS ref`);
  try {
    db.exec(
      `INSERT OR IGNORE INTO main.items (type, title, url)
       SELECT 'quote', text, url FROM ref.quotes`
    );
    db.exec(
      `INSERT INTO main.quotes (item_id, author, author_url, author_image, quote_year)
       SELECT i.id, q.author, q.author_url, q.author_image, q.quote_year
       FROM ref.quotes q
       JOIN main.items i ON i.url = q.url
       ON CONFLICT(item_id) DO UPDATE SET
         author = excluded.author,
         quote_year = COALESCE(excluded.quote_year, main.quotes.quote_year)`
    );
    db.exec(
      `INSERT OR IGNORE INTO main.item_topics (item_id, dataset, topic)
       SELECT i.id, 'Quotes', 'Quote of the Day'
       FROM main.items i
       WHERE i.type = 'quote' AND NOT EXISTS (
         SELECT 1 FROM main.item_topics it WHERE it.item_id = i.id AND it.dataset = 'Quotes'
       )`
    );
    db.exec(
      `INSERT OR REPLACE INTO main.datasets (name, source_url)
       SELECT 'Quotes', value FROM ref.metadata WHERE key = 'source_url'`
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
