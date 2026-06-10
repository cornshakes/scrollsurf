// Seeds the integration-test / preview database at `e2e/.data/scrollsurf.db`.
// Called automatically by Playwright's globalSetup before tests run.
// Run directly with `tsx e2e/fixtures/seed-test-db.ts [--reset]` to reseed manually.

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import * as dbmod from '../../src/lib/db';
import { ARTICLE_FIXTURES, PICTURE_FIXTURES } from './fixtures';

const DATA_DIR = path.join('e2e', '.data');
const RESET = process.argv.includes('--reset');

// Must be set before init_db() is called (db_path() reads it lazily).
process.env.SCROLLSURF_DATA_DIR = DATA_DIR;

const all_article_urls = Object.values(ARTICLE_FIXTURES).flat();
const all_picture_urls = Object.values(PICTURE_FIXTURES).flat();

export const seed = async () => {
  if (RESET) {
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(path.join(DATA_DIR, `scrollsurf.db${suffix}`), { force: true });
    }
  }
  mkdirSync(DATA_DIR, { recursive: true });

  // Reuse the real schema (single source of truth) to create the DB + tables.
  dbmod.init_db();
  const db = dbmod.db;

  // Wanted-URL temp tables. Each reference DB only holds its own URLs, so a JOIN
  // against the full wanted set naturally selects just that dataset's rows.
  db.exec('CREATE TEMP TABLE wanted_articles (url TEXT PRIMARY KEY)');
  db.exec('CREATE TEMP TABLE wanted_pictures (url TEXT PRIMARY KEY)');
  const want_article = db.prepare('INSERT OR IGNORE INTO wanted_articles (url) VALUES (?)');
  const want_picture = db.prepare('INSERT OR IGNORE INTO wanted_pictures (url) VALUES (?)');
  for (const url of all_article_urls) {
    want_article.run(url);
  }
  for (const url of all_picture_urls) {
    want_picture.run(url);
  }

  const dataset_path = (filename: string) => path.join(DATA_DIR, '..', '..', 'datasets', filename);

  const import_articles = (filename: string) => {
    const ref_path = dataset_path(filename);
    if (!existsSync(ref_path)) {
      throw new Error(`missing reference DB: ${ref_path} (build it with its download-* script)`);
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

      db.exec(`
        INSERT OR IGNORE INTO main.articles (title, extract, url, description, image_url)
        SELECT a.title, a.extract, a.url, a.description, a.image_url
        FROM ref.articles a
        JOIN wanted_articles w ON w.url = a.url
      `);
      db.exec(`
        INSERT OR IGNORE INTO main.categories (name, hidden)
        SELECT DISTINCT rac.name, rac.hidden
        FROM ref.article_categories rac
        JOIN wanted_articles w ON w.url = rac.url
      `);
      db.exec(`
        INSERT OR IGNORE INTO main.article_categories (article_id, category_id)
        SELECT a.id, c.id
        FROM ref.article_categories rac
        JOIN wanted_articles w ON w.url = rac.url
        JOIN main.articles a ON a.url = rac.url
        JOIN main.categories c ON c.name = rac.name
      `);
      db.exec(`
        INSERT OR IGNORE INTO main.article_topics (article_id, dataset, topic)
        SELECT a.id, '${dataset}', rt.topic
        FROM ref.article_topics rt
        JOIN wanted_articles w ON w.url = rt.url
        JOIN main.articles a ON a.url = rt.url
      `);
      db.exec(`
        INSERT OR REPLACE INTO main.datasets (name, source_url)
        VALUES ('${dataset}', (SELECT value FROM ref.metadata WHERE key = 'source_url'))
      `);
    } finally {
      db.exec('DETACH ref');
    }
  };

  const import_pictures = (filename: string) => {
    const ref_path = dataset_path(filename);
    if (!existsSync(ref_path)) {
      throw new Error(`missing reference DB: ${ref_path} (build it with its download-* script)`);
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

      db.exec(`
        INSERT OR IGNORE INTO main.pictures (title, url, image_url, caption, credit)
        SELECT p.file_title, p.url, p.image_url, COALESCE(d.caption, ''), p.credit
        FROM ref.pictures p
        LEFT JOIN ref.discovered_pictures d ON d.file_title = p.file_title
        JOIN wanted_pictures w ON w.url = p.url
      `);
      db.exec(`
        INSERT OR IGNORE INTO main.picture_topics (picture_id, dataset, topic)
        SELECT p.id, '${dataset}', rpt.topic
        FROM ref.picture_topics rpt
        JOIN wanted_pictures w ON w.url = rpt.url
        JOIN main.pictures p ON p.url = rpt.url
      `);
      db.exec(`
        INSERT OR REPLACE INTO main.datasets (name, source_url)
        VALUES ('${dataset}', (SELECT value FROM ref.metadata WHERE key = 'source_url'))
      `);
    } finally {
      db.exec('DETACH ref');
    }
  };

  for (const filename of Object.keys(ARTICLE_FIXTURES)) {
    import_articles(filename);
  }
  for (const filename of Object.keys(PICTURE_FIXTURES)) {
    import_pictures(filename);
  }

  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  // eslint-disable-next-line no-console
  console.log(
    `[seed] ${DATA_DIR}/scrollsurf.db seeded: ` +
      `${count('articles')} articles, ${count('pictures')} pictures, ` +
      `${count('datasets')} datasets, ${count('article_topics')} article_topics, ` +
      `${count('picture_topics')} picture_topics`
  );

  // Release the connection so it doesn't contend with the server's connection during tests.
  db.close();
};

// Only auto-run when invoked directly, not when imported by globalSetup.
if (process.argv[1]?.includes('seed-test-db')) {
  seed().catch((err) => {
    console.error('[seed] failed:', err);
    process.exit(1);
  });
}
