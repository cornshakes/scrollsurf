import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const SOURCE_URL = 'https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month';
const DATASET_TITLE = 'Quotes';

export interface DiscoveredQuote {
  url: string;
  text: string;
  author: string;
  author_url: string | null;
}

export const open_quotes_db = (filename: string): DatabaseSync => {
  const db = new DatabaseSync(path.join(process.cwd(), 'datasets', filename));
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      text         TEXT NOT NULL,
      url          TEXT NOT NULL UNIQUE,
      author       TEXT NOT NULL,
      author_url   TEXT,
      author_image TEXT
    );
    CREATE TABLE IF NOT EXISTS discovered_quotes (
      url        TEXT NOT NULL PRIMARY KEY,
      text       TEXT NOT NULL,
      author     TEXT NOT NULL,
      author_url TEXT
    );
    CREATE TABLE IF NOT EXISTS discovered_months (
      page TEXT NOT NULL PRIMARY KEY,
      done INTEGER NOT NULL DEFAULT 0
    );
    -- Author-page thumbnail cache: a row means the page was looked up (image may
    -- be NULL if it has none), so re-runs skip already-fetched authors.
    CREATE TABLE IF NOT EXISTS author_images (
      author_url TEXT NOT NULL PRIMARY KEY,
      image      TEXT
    );
  `);

  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(
    'title',
    DATASET_TITLE
  );
  db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(
    'source_url',
    SOURCE_URL
  );

  return db;
};

export const needs_discovery = (db: DatabaseSync): boolean => {
  const row = db.prepare('SELECT COUNT(*) AS n FROM discovered_months').get() as { n: number };
  return row.n === 0;
};

export const record_months = (db: DatabaseSync, pages: string[]): void => {
  const insert = db.prepare('INSERT OR IGNORE INTO discovered_months (page) VALUES (?)');
  db.exec('BEGIN');
  for (const page of pages) {
    insert.run(page);
  }
  db.exec('COMMIT');
};

export const get_undone_months = (db: DatabaseSync): string[] => {
  const rows = db
    .prepare('SELECT page FROM discovered_months WHERE done = 0 ORDER BY page')
    .all() as unknown as { page: string }[];
  return rows.map((r) => r.page);
};

export const mark_month_done = (db: DatabaseSync, page: string): void => {
  db.prepare('UPDATE discovered_months SET done = 1 WHERE page = ?').run(page);
};

export const insert_discovered_quotes = (db: DatabaseSync, quotes: DiscoveredQuote[]): void => {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO discovered_quotes (url, text, author, author_url) VALUES (?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  for (const q of quotes) {
    insert.run(q.url, q.text, q.author, q.author_url ?? null);
  }
  db.exec('COMMIT');
};

export const finalize_quotes = (db: DatabaseSync): void => {
  db.exec(
    'INSERT OR IGNORE INTO quotes (text, url, author, author_url) SELECT text, url, author, author_url FROM discovered_quotes'
  );
};

export interface AuthorImage {
  author_url: string;
  image: string | null;
}

// Distinct author pages not yet looked up (absent from author_images). Used to
// drive the resumable image-fetch phase.
export const get_author_urls_needing_images = (db: DatabaseSync): string[] => {
  const rows = db
    .prepare(
      `SELECT DISTINCT author_url FROM quotes
       WHERE author_url IS NOT NULL
         AND author_url NOT IN (SELECT author_url FROM author_images)
       ORDER BY author_url`
    )
    .all() as unknown as { author_url: string }[];
  return rows.map((row) => row.author_url);
};

export const record_author_images = (db: DatabaseSync, images: AuthorImage[]): void => {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO author_images (author_url, image) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  for (const entry of images) {
    insert.run(entry.author_url, entry.image);
  }
  db.exec('COMMIT');
};

// Copy looked-up thumbnails onto the finalized quotes (leaving already-set rows
// and authors with no image untouched).
export const apply_author_images = (db: DatabaseSync): void => {
  db.exec(
    `UPDATE quotes
     SET author_image = (
       SELECT image FROM author_images WHERE author_images.author_url = quotes.author_url
     )
     WHERE author_image IS NULL
       AND author_url IN (SELECT author_url FROM author_images)`
  );
};
