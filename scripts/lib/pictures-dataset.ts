// Separate download pipeline for picture datasets (e.g. Featured pictures).
// Fully parallel to dataset.ts — no shared types with the article pipeline.

import { chunk } from 'es-toolkit';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { skip_discovery } from './discovery';
import { fetch_image_content, type ImageInfo } from './wiki';

const BATCH_SIZE = 50;

export interface DiscoveredPicture {
  file_title: string; // e.g. "File:Name.jpg"
  caption: string; // display text from gallery
  credit: string | null; // photographer credit
  topic: string; // section heading
}

export interface DownloadPicturesOptions {
  filename: string; // e.g. 'featured_pictures.db'
  title: string; // grouping label, e.g. 'Pictures'
  source_url: string;
  fetch_image_info?: (titles: string[]) => Promise<ImageInfo[]>;
  fetch_categories?: (file_titles: string[]) => Promise<Map<string, string[]>>;
  discover: () => Promise<DiscoveredPicture[]>;
}

const open_pictures_db = (filename: string, title: string, source_url: string) => {
  const db = new DatabaseSync(path.join(process.cwd(), 'datasets', filename));
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key   TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pictures (
      file_title  TEXT NOT NULL,
      url         TEXT NOT NULL UNIQUE,
      image_url   TEXT NOT NULL,
      caption     TEXT NOT NULL DEFAULT '',
      credit      TEXT
    );
    CREATE TABLE IF NOT EXISTS picture_topics (
      url   TEXT NOT NULL,
      topic TEXT NOT NULL,
      PRIMARY KEY (url, topic)
    );
    CREATE TABLE IF NOT EXISTS commons_categories (
      url  TEXT NOT NULL,
      name TEXT NOT NULL,
      PRIMARY KEY (url, name)
    );
    CREATE TABLE IF NOT EXISTS discovered_pictures (
      file_title TEXT NOT NULL,
      caption    TEXT NOT NULL DEFAULT '',
      credit     TEXT,
      topic      TEXT NOT NULL DEFAULT '',
      done       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (file_title, topic)
    );
  `);

  const set_metadata = db.prepare(
    'INSERT OR REPLACE INTO metadata (key, value) VALUES ($key, $value)'
  );
  set_metadata.run({ $key: 'title', $value: title });
  set_metadata.run({ $key: 'source_url', $value: source_url });
  return db;
};

// Phase 1: always re-run discovery so pictures newly promoted upstream are
// picked up, and merge the result into discovered_pictures. INSERT OR IGNORE
// keeps it idempotent — rows already downloaded keep their done flag and are not
// re-fetched. Pass --no-discover (or SKIP_DISCOVERY=1) to read the cache instead.
const discover_with_cache = async (
  db: DatabaseSync,
  discover: () => Promise<DiscoveredPicture[]>
): Promise<DiscoveredPicture[]> => {
  const read_cache = (): DiscoveredPicture[] =>
    db
      .prepare('SELECT file_title, caption, credit, topic FROM discovered_pictures')
      .all() as unknown as DiscoveredPicture[];

  if (skip_discovery()) {
    const cached = read_cache();
    const unique = new Set(cached.map((entry) => entry.file_title)).size;
    process.stdout.write(
      `Phase 1: Skipped by request (${unique} unique pictures already discovered).\n`
    );
    return cached;
  }

  const known_before = new Set(
    (
      db.prepare('SELECT DISTINCT file_title FROM discovered_pictures').all() as {
        file_title: string;
      }[]
    ).map((row) => row.file_title)
  );

  process.stdout.write('Phase 1: Discovering picture URLs...\n');
  const discovered = await discover();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO discovered_pictures (file_title, caption, credit, topic) VALUES (?, ?, ?, ?)'
  );
  db.exec('BEGIN');
  for (const { file_title, caption, credit, topic } of discovered) {
    insert.run(file_title, caption, credit ?? null, topic);
  }
  db.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('urls_fetched', '1')").run();
  db.exec('COMMIT');

  const unique_titles = new Set(discovered.map((entry) => entry.file_title));
  const added = [...unique_titles].filter((file_title) => !known_before.has(file_title)).length;
  const missing = [...known_before].filter((file_title) => !unique_titles.has(file_title)).length;
  process.stdout.write(
    `Found ${unique_titles.size} unique pictures (${added} new since last run` +
      `${missing > 0 ? `, ${missing} no longer listed upstream` : ''}).\n`
  );

  // Return the union of freshly discovered and previously cached entries: a
  // picture dropped upstream stays in the dataset rather than losing its topics.
  return read_cache();
};

export const download_pictures_dataset = async (
  options: DownloadPicturesOptions
): Promise<void> => {
  const db = open_pictures_db(options.filename, options.title, options.source_url);

  const discovered = await discover_with_cache(db, options.discover);

  // file_title -> { caption, credit, topics[] } — caption/credit from first occurrence
  const pic_map = new Map(
    [...Map.groupBy(discovered, (d) => d.file_title)].map(([file_title, items]) => [
      file_title,
      {
        caption: items[0].caption,
        credit: items[0].credit,
        topics: new Set(items.map((d) => d.topic)),
      },
    ])
  );

  // Seed done flag from already-saved pictures.
  db.exec(
    'UPDATE discovered_pictures SET done = 1 WHERE done = 0 AND file_title IN (SELECT file_title FROM pictures)'
  );

  const to_download = (
    db.prepare('SELECT DISTINCT file_title FROM discovered_pictures WHERE done = 0').all() as {
      file_title: string;
    }[]
  ).map((r) => r.file_title);

  process.stdout.write(
    `${to_download.length} new pictures to download (${pic_map.size - to_download.length} already downloaded).\n`
  );
  if (to_download.length === 0) {
    process.stdout.write('Done.\n');
    return;
  }

  const insert_picture = db.prepare(
    'INSERT OR IGNORE INTO pictures (file_title, url, image_url, caption, credit) VALUES ($file_title, $url, $image_url, $caption, $credit)'
  );
  const insert_topic = db.prepare(
    'INSERT OR IGNORE INTO picture_topics (url, topic) VALUES ($url, $topic)'
  );
  const insert_category = db.prepare(
    'INSERT OR IGNORE INTO commons_categories (url, name) VALUES ($url, $name)'
  );
  const mark_done = db.prepare(
    'UPDATE discovered_pictures SET done = 1 WHERE file_title = $file_title'
  );

  process.stdout.write('Phase 2: Downloading image info (thumbnail URL, description page)...\n');
  let processed = 0;
  for (const batch of chunk(to_download, BATCH_SIZE)) {
    const images = await (options.fetch_image_info ?? fetch_image_content)(batch);
    const by_title = new Map(images.map((img) => [img.title, img]));

    let categories_by_url: Map<string, string[]> = new Map();
    if (options.fetch_categories) {
      categories_by_url = await options.fetch_categories(batch);
    }

    db.exec('BEGIN');
    for (const file_title of batch) {
      const img = by_title.get(file_title);
      if (img) {
        const meta = pic_map.get(file_title);
        insert_picture.run({
          $file_title: file_title,
          $url: img.descriptionurl,
          $image_url: img.thumburl,
          $caption: meta?.caption ?? '',
          $credit: img.credit ?? meta?.credit ?? null,
        });
        for (const topic of meta?.topics ?? []) {
          insert_topic.run({ $url: img.descriptionurl, $topic: topic });
        }
        const categories = categories_by_url.get(file_title) ?? [];
        for (const category_name of categories) {
          insert_category.run({ $url: img.descriptionurl, $name: category_name });
        }
      }
      mark_done.run({ $file_title: file_title });
      processed++;
    }
    db.exec('COMMIT');
    process.stdout.write(`\r${processed} / ${to_download.length} processed`);
  }

  process.stdout.write('\nDone.\n');
};

export const run_download_pictures = (options: DownloadPicturesOptions): void => {
  download_pictures_dataset(options).catch((err) => {
    console.error(err);
    process.exit(1);
  });
};
