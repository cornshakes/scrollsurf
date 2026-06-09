// Separate download pipeline for picture datasets (e.g. Featured pictures).
// Fully parallel to dataset.ts — no shared types with the article pipeline.

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
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

const discover_with_cache = async (
  db: DatabaseSync,
  discover: () => Promise<DiscoveredPicture[]>
): Promise<DiscoveredPicture[]> => {
  const fetched = db.prepare("SELECT 1 FROM metadata WHERE key = 'urls_fetched'").get();
  if (fetched) {
    const rows = db
      .prepare('SELECT file_title, caption, credit, topic FROM discovered_pictures')
      .all() as unknown as DiscoveredPicture[];
    const unique = new Set(rows.map((r) => r.file_title)).size;
    process.stdout.write(`Phase 1: Skipped (${unique} unique pictures already discovered).\n`);
    return rows;
  }

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

  const unique = new Set(discovered.map((d) => d.file_title)).size;
  process.stdout.write(`Found ${unique} unique pictures.\n`);
  return discovered;
};

export const download_pictures_dataset = async (
  options: DownloadPicturesOptions
): Promise<void> => {
  const db = open_pictures_db(options.filename, options.title, options.source_url);

  const discovered = await discover_with_cache(db, options.discover);

  // file_title -> { caption, credit, topics[] }
  const pic_map = new Map<
    string,
    { caption: string; credit: string | null; topics: Set<string> }
  >();
  for (const { file_title, caption, credit, topic } of discovered) {
    if (!pic_map.has(file_title)) {
      pic_map.set(file_title, { caption, credit: credit ?? null, topics: new Set() });
    }
    if (topic) {
      pic_map.get(file_title)?.topics.add(topic);
    }
  }

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
  const mark_done = db.prepare(
    'UPDATE discovered_pictures SET done = 1 WHERE file_title = $file_title'
  );

  process.stdout.write('Phase 2: Downloading image info (thumbnail URL, description page)...\n');
  let processed = 0;
  for (let i = 0; i < to_download.length; i += BATCH_SIZE) {
    const batch = to_download.slice(i, i + BATCH_SIZE);
    const images = await (options.fetch_image_info ?? fetch_image_content)(batch);
    const by_title = new Map(images.map((img) => [img.title, img]));

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
