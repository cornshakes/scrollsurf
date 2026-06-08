// Reference-DB layer + download orchestration — shared by all dataset download
// scripts. Each script supplies only its filename, source URL, and a discover()
// that finds article titles (+ optional topics); everything else lives here.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fetch_article_content, title_to_url } from './wiki';

const BATCH_SIZE = 15;

export interface DiscoveredArticle {
  title: string;
  topic?: string;
}

export interface DownloadDatasetOptions {
  filename: string; // e.g. 'good_articles.db'
  title: string; // grouping label, e.g. 'Good' — stored in metadata
  source_url: string;
  discover: () => Promise<DiscoveredArticle[]>;
}

const open_reference_db = (filename: string, title: string, source_url: string) => {
  const db = new DatabaseSync(path.join(process.cwd(), 'datasets', filename));
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS articles (
      title       TEXT NOT NULL,
      url         TEXT NOT NULL UNIQUE,
      extract     TEXT NOT NULL,
      description TEXT,
      image_url   TEXT
    );
    CREATE TABLE IF NOT EXISTS article_topics (
      url   TEXT NOT NULL,
      topic TEXT NOT NULL,
      PRIMARY KEY (url, topic)
    );
    CREATE TABLE IF NOT EXISTS article_categories (
      url    TEXT NOT NULL,
      name   TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (url, name)
    );
    CREATE TABLE IF NOT EXISTS discovered_articles (
      title TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT '',
      done  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (title, topic)
    );
  `);

  // Migrate discovered_articles tables created before the `done` column existed.
  const columns = db.prepare('PRAGMA table_info(discovered_articles)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'done')) {
    db.exec('ALTER TABLE discovered_articles ADD COLUMN done INTEGER NOT NULL DEFAULT 0');
  }
  const set_metadata = db.prepare(
    'INSERT OR REPLACE INTO metadata (key, value) VALUES ($key, $value)'
  );
  set_metadata.run({ $key: 'title', $value: title });
  set_metadata.run({ $key: 'source_url', $value: source_url });
  return db;
};

// Phase 1 with caching: discover article titles once, persist them to
// discovered_articles, and flag completion in metadata. Re-runs read the cache.
const discover_with_cache = async (
  db: DatabaseSync,
  discover: () => Promise<DiscoveredArticle[]>
): Promise<DiscoveredArticle[]> => {
  const fetched = db.prepare("SELECT 1 FROM metadata WHERE key = 'urls_fetched'").get();
  if (fetched) {
    const rows = db.prepare('SELECT title, topic FROM discovered_articles').all() as {
      title: string;
      topic: string;
    }[];
    const unique = new Set(rows.map((r) => r.title)).size;
    process.stdout.write(`Phase 1: Skipped (${unique} unique articles already discovered).\n`);
    return rows.map((r) => ({ title: r.title, topic: r.topic || undefined }));
  }

  process.stdout.write('Phase 1: Discovering article URLs...\n');
  const discovered = await discover();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO discovered_articles (title, topic) VALUES (?, ?)'
  );
  db.exec('BEGIN');
  for (const { title, topic } of discovered) insert.run(title, topic ?? '');
  db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('urls_fetched', '1')").run();
  db.exec('COMMIT');

  const unique = new Set(discovered.map((d) => d.title)).size;
  process.stdout.write(`Found ${unique} unique articles.\n`);
  return discovered;
};

export const download_dataset = async (options: DownloadDatasetOptions): Promise<void> => {
  const db = open_reference_db(options.filename, options.title, options.source_url);

  const discovered = await discover_with_cache(db, options.discover);

  // title -> set of topics (an article may appear under several topics)
  const topic_map = new Map<string, Set<string>>();
  for (const { title, topic } of discovered) {
    if (!topic_map.has(title)) topic_map.set(title, new Set());
    if (topic) topic_map.get(title)?.add(topic);
  }

  // Seed the done flag from already-saved articles (covers DBs downloaded before
  // the flag existed). Matches by exact title; normalized/redirect titles that
  // don't match are attempted once below, then marked done so they never repeat.
  db.exec(
    'UPDATE discovered_articles SET done = 1 WHERE done = 0 AND title IN (SELECT title FROM articles)'
  );

  const to_download = (
    db.prepare('SELECT DISTINCT title FROM discovered_articles WHERE done = 0').all() as {
      title: string;
    }[]
  ).map((r) => r.title);
  process.stdout.write(
    `${to_download.length} new articles to download (${topic_map.size - to_download.length} already downloaded).\n`
  );
  if (to_download.length === 0) {
    process.stdout.write('Done.\n');
    return;
  }

  const insert_article = db.prepare(
    'INSERT OR IGNORE INTO articles (title, url, extract, description, image_url) VALUES ($title, $url, $extract, $description, $image_url)'
  );
  const insert_topic = db.prepare(
    'INSERT OR IGNORE INTO article_topics (url, topic) VALUES ($url, $topic)'
  );
  const insert_category = db.prepare(
    'INSERT OR IGNORE INTO article_categories (url, name, hidden) VALUES ($url, $name, $hidden)'
  );
  const mark_done = db.prepare('UPDATE discovered_articles SET done = 1 WHERE title = $title');

  process.stdout.write('Phase 2: Downloading article content (extract, description, image)...\n');
  let processed = 0;
  for (let i = 0; i < to_download.length; i += BATCH_SIZE) {
    const batch = to_download.slice(i, i + BATCH_SIZE);
    const { pages, resolve } = await fetch_article_content(batch);
    const page_by_title = new Map(pages.map((p) => [p.title, p]));

    db.exec('BEGIN');
    for (const requested of batch) {
      const p = page_by_title.get(resolve(requested));
      if (p) {
        const url = title_to_url(p.title);
        insert_article.run({
          $title: p.title,
          $url: url,
          $extract: p.extract as string,
          $description: p.description ?? null,
          $image_url: p.thumbnail?.source ?? null,
        });
        // Topics come from the requested (discovered) title, not the resolved one.
        for (const topic of topic_map.get(requested) ?? []) {
          insert_topic.run({ $url: url, $topic: topic });
        }
        for (const cat of p.categories ?? []) {
          insert_category.run({
            $url: url,
            $name: cat.title.replace(/^Category:/, ''),
            $hidden: 'hidden' in cat ? 1 : 0,
          });
        }
      }
      // Mark attempted regardless: a title that resolves to no page (e.g. a
      // redirect with no extract) must not be re-requested on every run.
      mark_done.run({ $title: requested });
      processed++;
    }
    db.exec('COMMIT');
    process.stdout.write(`\r${processed} / ${to_download.length} processed`);
  }

  process.stdout.write('\nDone.\n');
};

// Wraps download_dataset with the standard error-exit handling each script uses.
export const run_download = (options: DownloadDatasetOptions): void => {
  download_dataset(options).catch((err) => {
    console.error(err);
    process.exit(1);
  });
};
