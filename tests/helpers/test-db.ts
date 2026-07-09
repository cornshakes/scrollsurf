import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { get_db, init_db } from '@/lib/db/connection';
import { randomUUID } from 'node:crypto';
import { rebuild_feed_index } from '@/lib/db';

let test_dir: string;

export const setup = () => {
  test_dir = path.join(
    os.tmpdir(),
    `scrollsurf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(test_dir, { recursive: true });
  // Must be set before init_db() is called — connection.ts reads this lazily.
  // This overrides the SCROLLSURF_DATA_DIR=. from .env.test so all modules
  // (articles.ts, pictures.ts, topics.ts, …) share this temp DB.
  process.env.SCROLLSURF_DATA_DIR = test_dir;
};

export const reset_db = () => {
  const target_db = path.join(test_dir, 'scrollsurf.db');
  rmSync(target_db, { force: true });
  rmSync(target_db + '-wal', { force: true });
  rmSync(target_db + '-shm', { force: true });
  init_db(true);
};

export const insert_user = (token?: string): number => {
  const db = get_db();
  const now = Math.floor(Date.now() / 1000);
  const tok = token ?? randomUUID();
  db.prepare('INSERT INTO users (created_at, last_active_at) VALUES (?, ?)').run(now, now);
  const user_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
  db.prepare(
    'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
  ).run(tok, user_id, now, now);
  return user_id;
};

export const insert_user_with_email = (email: string, token: string): number => {
  const db = get_db();
  const now = Math.floor(Date.now() / 1000);
  const result = db
    .prepare('INSERT INTO users (email, created_at, last_active_at) VALUES (?, ?, ?)')
    .run(email, now, now);
  const user_id = Number(result.lastInsertRowid);
  db.prepare(
    'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
  ).run(token, user_id, now, now);
  return user_id;
};

export const insert_article = (
  data?: Partial<{
    title: string;
    extract: string;
    url: string;
    description: string;
    image_url: string;
    topics: Array<{ dataset: string; topic: string }>;
    categories: string[];
  }>,
  rebuild_index = true
): number => {
  const db = get_db();
  const defaults = {
    title: `Article ${Date.now()}`,
    extract: 'Test extract',
    url: `https://example.com/${Date.now()}`,
    description: 'Test description',
    image_url: null,
    topics: [{ dataset: 'TestDataset', topic: 'TestTopic' }],
    categories: [],
  };
  const merged = { ...defaults, ...data };
  db.prepare('INSERT INTO items (type, title, url) VALUES ($type, $title, $url)').run({
    $type: 'article',
    $title: merged.title,
    $url: merged.url,
  });
  const item_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
  db.prepare(
    'INSERT INTO articles (item_id, extract, description, image_url) VALUES ($item_id, $extract, $description, $image_url)'
  ).run({
    $item_id: item_id,
    $extract: merged.extract,
    $description: merged.description,
    $image_url: merged.image_url,
  });
  for (const t of merged.topics ?? []) {
    db.prepare('INSERT OR IGNORE INTO datasets (name, source_url) VALUES (?, ?)').run(
      t.dataset,
      `https://en.wikipedia.org/wiki/${t.dataset}`
    );
    db.prepare('INSERT INTO item_topics (item_id, dataset, topic) VALUES (?, ?, ?)').run(
      item_id,
      t.dataset,
      t.topic
    );
    ensure_topic_bucket(t.dataset, t.topic);
  }
  for (const cat of merged.categories ?? []) {
    db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(cat);
    const cat_id = (
      db.prepare('SELECT id FROM categories WHERE name = ?').get(cat) as { id: number }
    ).id;
    db.prepare('INSERT INTO item_categories (item_id, category_id) VALUES (?, ?)').run(
      item_id,
      cat_id
    );
  }
  if (rebuild_index) {
    rebuild_feed_index();
  }
  return item_id;
};

export const insert_picture = (
  data: {
    title?: string;
    url?: string;
    image_url: string;
    caption?: string;
    credit?: string;
    topics?: Array<{ dataset: string; topic: string }>;
  },
  rebuild_index = true
): number => {
  const db = get_db();
  const title = data.title ?? `Picture ${Date.now()}`;
  const url = data.url ?? `https://example.com/p/${Date.now()}`;
  db.prepare('INSERT INTO items (type, title, url) VALUES ($type, $title, $url)').run({
    $type: 'picture',
    $title: title,
    $url: url,
  });
  const item_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
  db.prepare(
    'INSERT INTO pictures (item_id, image_url, caption, credit) VALUES ($item_id, $image_url, $caption, $credit)'
  ).run({
    $item_id: item_id,
    $image_url: data.image_url,
    $caption: data.caption ?? '',
    $credit: data.credit ?? null,
  });
  for (const t of data.topics ?? [{ dataset: 'TestDataset', topic: 'TestTopic' }]) {
    db.prepare('INSERT OR IGNORE INTO datasets (name, source_url) VALUES (?, ?)').run(
      t.dataset,
      `https://en.wikipedia.org/wiki/${t.dataset}`
    );
    db.prepare('INSERT INTO item_topics (item_id, dataset, topic) VALUES (?, ?, ?)').run(
      item_id,
      t.dataset,
      t.topic
    );
    ensure_topic_bucket(t.dataset, t.topic);
  }
  if (rebuild_index) {
    rebuild_feed_index();
  }
  return item_id;
};

export const insert_quote = (
  data: {
    text: string;
    url: string;
    author: string;
    author_url: string;
    author_image?: string | null;
    quote_year?: string | null;
  },
  rebuild_index = true
): number => {
  const db = get_db();
  const title = data.text ?? `Quote ${Date.now()}`;
  const url = data.url ?? `https://en.wikiquote.org/wiki/test/${Date.now()}`;
  db.prepare('INSERT INTO items (type, title, url) VALUES ($type, $title, $url)').run({
    $type: 'quote',
    $title: title,
    $url: url,
  });
  const item_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
  db.prepare(
    `INSERT INTO quotes (item_id, author, author_url, author_image, quote_year)
     VALUES ($item_id, $author, $author_url, $author_image, $quote_year)`
  ).run({
    $item_id: item_id,
    $author: data.author,
    $author_url: data.author_url,
    $author_image: data.author_image ?? null,
    $quote_year: data.quote_year ?? null,
  });
  db.prepare('INSERT OR IGNORE INTO datasets (name, source_url) VALUES (?, ?)').run(
    'Quotes',
    'https://en.wikiquote.org/wiki/Wikiquote:QOTD_by_month'
  );
  db.prepare('INSERT INTO item_topics (item_id, dataset, topic) VALUES (?, ?, ?)').run(
    item_id,
    'Quotes',
    'Quote of the Day'
  );
  ensure_topic_bucket('Quotes', 'Quote of the Day');
  if (rebuild_index) {
    rebuild_feed_index();
  }
  return item_id;
};

const ensure_topic_bucket = (dataset: string, topic: string): void => {
  const db = get_db();
  db.prepare('INSERT OR IGNORE INTO topic_buckets (dataset, topic, bucket) VALUES (?, ?, ?)').run(
    dataset,
    topic,
    `${dataset} x ${topic}`
  );
};

export const insert_topic_bucket = (dataset: string, topic: string, bucket: string): void => {
  const db = get_db();
  db.prepare('INSERT OR REPLACE INTO topic_buckets (dataset, topic, bucket) VALUES (?, ?, ?)').run(
    dataset,
    topic,
    bucket
  );
};
