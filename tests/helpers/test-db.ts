import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { init_db, get_db } from '@/lib/db/connection';
import { randomUUID } from 'node:crypto';

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
  init_db();
};

export const get_test_db = () => get_db();

export const cleanup = () => {
  try {
    get_db().close();
  } catch {}
  if (test_dir) {
    try {
      rmSync(test_dir, { recursive: true, force: true });
    } catch {}
  }
};

export const reset = () => {
  const db = get_db();
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DELETE FROM user_clicks;
    DELETE FROM user_settings;
    DELETE FROM user_pictures;
    DELETE FROM user_articles;
    DELETE FROM users;
    DELETE FROM picture_topics;
    DELETE FROM pictures;
    DELETE FROM category_hierarchy;
    DELETE FROM article_topics;
    DELETE FROM article_categories;
    DELETE FROM datasets;
    DELETE FROM categories;
    DELETE FROM articles;
    DELETE FROM sqlite_sequence WHERE name IN ('articles', 'categories', 'pictures', 'users', 'user_clicks');
    PRAGMA foreign_keys = ON;
  `);
};

export const insert_user = (cookie_token?: string): number => {
  const db = get_db();
  const now = Math.floor(Date.now() / 1000);
  const token = cookie_token ?? randomUUID();
  const stmt = db.prepare(
    'INSERT INTO users (cookie_token, created_at, last_active_at) VALUES ($token, $now, $now)'
  );
  stmt.run({ $token: token, $now: now });
  return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
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
  }>
): number => {
  const db = get_db();
  const defaults = {
    title: `Article ${Date.now()}`,
    extract: 'Test extract',
    url: `https://example.com/${Date.now()}`,
    description: 'Test description',
    image_url: null,
    topics: [],
    categories: [],
  };
  const merged = { ...defaults, ...data };
  const stmt = db.prepare(
    'INSERT INTO articles (title, extract, url, description, image_url) VALUES ($title, $extract, $url, $description, $image_url)'
  );
  stmt.run({
    $title: merged.title,
    $extract: merged.extract,
    $url: merged.url,
    $description: merged.description,
    $image_url: merged.image_url,
  });
  const id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
  for (const t of merged.topics ?? []) {
    db.prepare('INSERT OR IGNORE INTO datasets (name) VALUES (?)').run(t.dataset);
    db.prepare('INSERT INTO article_topics (article_id, dataset, topic) VALUES (?, ?, ?)').run(
      id,
      t.dataset,
      t.topic
    );
  }
  for (const cat of merged.categories ?? []) {
    db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)').run(cat);
    const cat_id = (
      db.prepare('SELECT id FROM categories WHERE name = ?').get(cat) as { id: number }
    ).id;
    db.prepare('INSERT INTO article_categories (article_id, category_id) VALUES (?, ?)').run(
      id,
      cat_id
    );
  }
  return id;
};

export const insert_dataset = (name: string, source_url?: string): void => {
  const db = get_db();
  const stmt = db.prepare('INSERT INTO datasets (name, source_url) VALUES ($name, $source_url)');
  stmt.run({ $name: name, $source_url: source_url ?? null });
};

export const insert_picture = (data: {
  title?: string;
  url?: string;
  image_url: string;
  caption?: string;
  credit?: string;
  topics?: Array<{ dataset: string; topic: string }>;
}): number => {
  const db = get_db();
  const title = data.title ?? `Picture ${Date.now()}`;
  const url = data.url ?? `https://example.com/p/${Date.now()}`;
  db.prepare(
    'INSERT INTO pictures (title, url, image_url, caption, credit) VALUES ($title, $url, $image_url, $caption, $credit)'
  ).run({
    $title: title,
    $url: url,
    $image_url: data.image_url,
    $caption: data.caption ?? '',
    $credit: data.credit ?? null,
  });
  const id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
  for (const t of data.topics ?? []) {
    db.prepare('INSERT OR IGNORE INTO datasets (name) VALUES (?)').run(t.dataset);
    db.prepare('INSERT INTO picture_topics (picture_id, dataset, topic) VALUES (?, ?, ?)').run(
      id,
      t.dataset,
      t.topic
    );
  }
  return id;
};

export const set_like = (
  type: 'article' | 'picture',
  item_id: number,
  user_id: number,
  value: -1 | 0 | 1
) => {
  const db = get_db();
  if (type === 'article') {
    db.prepare(
      `INSERT INTO user_articles (user_id, article_id, like) VALUES (?, ?, ?)
       ON CONFLICT(user_id, article_id) DO UPDATE SET like = excluded.like`
    ).run(user_id, item_id, value);
  } else {
    db.prepare(
      `INSERT INTO user_pictures (user_id, picture_id, like) VALUES (?, ?, ?)
       ON CONFLICT(user_id, picture_id) DO UPDATE SET like = excluded.like`
    ).run(user_id, item_id, value);
  }
};
