import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const SOURCE_URL = 'https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month';
const DATASET_TITLE = 'Quotes';

export interface DiscoveredQuote {
  url: string;
  text: string;
  author: string;
  author_url: string | null;
  qotd_date: string | null;
  // Work/theme page the quote is attributed to on its QOTD entry (the "in ~ … ~"
  // link), used to date quotes that aren't listed on the author's own page.
  source_url: string | null;
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
      author_image TEXT,
      quote_year   TEXT,
      qotd_date    TEXT,
      source_url   TEXT
    );
    CREATE TABLE IF NOT EXISTS discovered_quotes (
      url        TEXT NOT NULL PRIMARY KEY,
      text       TEXT NOT NULL,
      author     TEXT NOT NULL,
      author_url TEXT,
      qotd_date  TEXT,
      source_url TEXT
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
    -- Author pages whose section headers have been parsed for quote times. A row
    -- means the page was looked up, so re-runs skip it (the page is the unit of
    -- work — one fetch dates all of that author's quotes).
    CREATE TABLE IF NOT EXISTS author_times_done (
      author_url TEXT NOT NULL PRIMARY KEY
    );
    -- Source/work pages (e.g. "A Christmas Carol") parsed to date the quotes that
    -- the author page didn't. Same resumability contract as author_times_done.
    CREATE TABLE IF NOT EXISTS source_times_done (
      source_url TEXT NOT NULL PRIMARY KEY
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

export const count_months = (db: DatabaseSync): number => {
  const row = db.prepare('SELECT COUNT(*) AS n FROM discovered_months').get() as { n: number };
  return row.n;
};

// Clears the done flag for a month page so it is parsed again — used for the
// month in progress, which gains a new quote every day.
export const reopen_month = (db: DatabaseSync, page: string): void => {
  db.prepare('UPDATE discovered_months SET done = 0 WHERE page = ?').run(page);
};

// Months whose stored quotes stop short of the month's length were parsed while
// the month was still in progress (the QOTD page gains one entry per day), so
// they need re-parsing. `pages` maps a month page title to the number of days
// that month has; only past months are worth checking.
export const reopen_incomplete_months = (
  db: DatabaseSync,
  pages: Map<string, number>
): string[] => {
  const counts = db
    .prepare(
      `SELECT substr(qotd_date, 1, 7) AS month, COUNT(*) AS n FROM quotes
       WHERE qotd_date IS NOT NULL GROUP BY month`
    )
    .all() as unknown as { month: string; n: number }[];
  const by_month = new Map(counts.map((row) => [row.month, row.n]));

  const reopened: string[] = [];
  const update = db.prepare('UPDATE discovered_months SET done = 0 WHERE page = ? AND done = 1');
  for (const [page, days_in_month] of pages) {
    const month_key = month_key_for_page(page);
    if (month_key && (by_month.get(month_key) ?? 0) < days_in_month) {
      const result = update.run(page);
      if (Number(result.changes) > 0) {
        reopened.push(page);
      }
    }
  }
  return reopened;
};

const MONTH_NUMBERS = new Map(
  [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ].map((name, index) => [name, String(index + 1).padStart(2, '0')])
);

// "Wikiquote:Quote of the day/June 2026" -> "2026-06"
const month_key_for_page = (page: string): string | null => {
  const match = page.match(/\/([A-Za-z]+) (\d{4})$/);
  const month = match && MONTH_NUMBERS.get(match[1]);
  return match && month ? `${match[2]}-${month}` : null;
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
    'INSERT OR IGNORE INTO discovered_quotes (url, text, author, author_url, qotd_date, source_url) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  for (const q of quotes) {
    insert.run(
      q.url,
      q.text,
      q.author,
      q.author_url ?? null,
      q.qotd_date ?? null,
      q.source_url ?? null
    );
  }
  db.exec('COMMIT');
};

export const finalize_quotes = (db: DatabaseSync): void => {
  db.exec(
    'INSERT OR IGNORE INTO quotes (text, url, author, author_url, qotd_date, source_url) SELECT text, url, author, author_url, qotd_date, source_url FROM discovered_quotes'
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

export interface AuthorQuote {
  url: string;
  text: string;
}

// Distinct author pages not yet parsed for quote times (absent from
// author_times_done). Drives the resumable time-extraction phase.
export const get_author_urls_needing_times = (db: DatabaseSync): string[] => {
  const rows = db
    .prepare(
      `SELECT DISTINCT author_url FROM quotes
       WHERE author_url IS NOT NULL
         AND author_url NOT IN (SELECT author_url FROM author_times_done)
       ORDER BY author_url`
    )
    .all() as unknown as { author_url: string }[];
  return rows.map((row) => row.author_url);
};

// The (url, text) of every quote by one author, so the caller can match each
// against the parsed section headers of that author's page.
export const get_quotes_for_author = (db: DatabaseSync, author_url: string): AuthorQuote[] => {
  return db
    .prepare('SELECT url, text FROM quotes WHERE author_url = ?')
    .all(author_url) as unknown as AuthorQuote[];
};

// Persist one author's matched quote times and mark the page as parsed (even
// when no quotes matched, so it is not re-fetched next run).
export const apply_quote_times = (
  db: DatabaseSync,
  author_url: string,
  times: Array<{ url: string; quote_year: string }>
): void => {
  const update = db.prepare('UPDATE quotes SET quote_year = ? WHERE url = ?');
  const mark = db.prepare('INSERT OR IGNORE INTO author_times_done (author_url) VALUES (?)');
  db.exec('BEGIN');
  for (const entry of times) {
    update.run(entry.quote_year, entry.url);
  }
  mark.run(author_url);
  db.exec('COMMIT');
};

// Distinct source/work pages still worth fetching: those attached to at least one
// still-undated quote and not yet parsed. Quotes already dated by the author phase
// need no work-page lookup, so this naturally shrinks as coverage grows.
export const get_source_urls_needing_times = (db: DatabaseSync): string[] => {
  const rows = db
    .prepare(
      `SELECT DISTINCT source_url FROM quotes
       WHERE source_url IS NOT NULL
         AND quote_year IS NULL
         AND source_url NOT IN (SELECT source_url FROM source_times_done)
       ORDER BY source_url`
    )
    .all() as unknown as { source_url: string }[];
  return rows.map((row) => row.source_url);
};

// The still-undated quotes attributed to one source/work page, to match against
// that page's section headers.
export const get_undated_quotes_for_source = (
  db: DatabaseSync,
  source_url: string
): AuthorQuote[] => {
  return db
    .prepare('SELECT url, text FROM quotes WHERE source_url = ? AND quote_year IS NULL')
    .all(source_url) as unknown as AuthorQuote[];
};

// Persist matched times from one source/work page and mark it parsed.
export const apply_source_times = (
  db: DatabaseSync,
  source_url: string,
  times: Array<{ url: string; quote_year: string }>
): void => {
  const update = db.prepare('UPDATE quotes SET quote_year = ? WHERE url = ?');
  const mark = db.prepare('INSERT OR IGNORE INTO source_times_done (source_url) VALUES (?)');
  db.exec('BEGIN');
  for (const entry of times) {
    update.run(entry.quote_year, entry.url);
  }
  mark.run(source_url);
  db.exec('COMMIT');
};
