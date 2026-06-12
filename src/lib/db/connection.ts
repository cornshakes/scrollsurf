import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db_path } from '../paths';

export let db: DatabaseSync;

export const create_schema = (target: DatabaseSync) => {
  target.exec('PRAGMA journal_mode = WAL');
  target.exec('PRAGMA busy_timeout = 5000');
  target.exec('PRAGMA foreign_keys = ON');

  target.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      extract     TEXT    NOT NULL,
      url         TEXT    NOT NULL UNIQUE,
      description TEXT,
      image_url   TEXT
    );

    CREATE TABLE IF NOT EXISTS categories (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      name   TEXT    NOT NULL UNIQUE,
      hidden INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS article_categories (
      article_id  INTEGER NOT NULL REFERENCES articles(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      PRIMARY KEY (article_id, category_id)
    );

    CREATE TABLE IF NOT EXISTS article_topics (
      article_id INTEGER NOT NULL REFERENCES articles(id),
      dataset    TEXT    NOT NULL,
      topic      TEXT    NOT NULL,
      PRIMARY KEY (article_id, dataset, topic)
    );

    CREATE TABLE IF NOT EXISTS datasets (
      name       TEXT NOT NULL PRIMARY KEY,
      source_url TEXT
    );

    CREATE TABLE IF NOT EXISTS category_hierarchy (
      category_name TEXT NOT NULL PRIMARY KEY,
      top_level     TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pictures (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      title     TEXT    NOT NULL,
      url       TEXT    NOT NULL UNIQUE,
      image_url TEXT    NOT NULL,
      caption   TEXT    NOT NULL DEFAULT '',
      credit    TEXT
    );

    CREATE TABLE IF NOT EXISTS picture_topics (
      picture_id INTEGER NOT NULL REFERENCES pictures(id),
      dataset    TEXT    NOT NULL,
      topic      TEXT    NOT NULL,
      PRIMARY KEY (picture_id, dataset, topic)
    );

    CREATE TABLE IF NOT EXISTS users (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      cookie_token   TEXT UNIQUE,
      created_at     INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at);

    CREATE TABLE IF NOT EXISTS user_articles (
      user_id    INTEGER NOT NULL REFERENCES users(id),
      article_id INTEGER NOT NULL REFERENCES articles(id),
      like       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, article_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS user_pictures (
      user_id    INTEGER NOT NULL REFERENCES users(id),
      picture_id INTEGER NOT NULL REFERENCES pictures(id),
      like       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, picture_id)
    ) STRICT;

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL REFERENCES users(id),
      dataset TEXT    NOT NULL REFERENCES datasets(name),
      enabled INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, dataset)
    ) STRICT;

    -- Append-only engagement log of followed links (title, by, category, topic,
    -- dataset) — richer signal than the like/dislike vote alone.
    CREATE TABLE IF NOT EXISTS user_clicks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      item_type  TEXT    NOT NULL,
      item_id    INTEGER NOT NULL,
      link_type  TEXT    NOT NULL,
      link_label TEXT,
      created_at INTEGER NOT NULL
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_user_clicks_user ON user_clicks(user_id);
  `);

  try {
    target.exec("ALTER TABLE pictures ADD COLUMN caption TEXT NOT NULL DEFAULT ''");
  } catch {}
};

export const init_db = () => {
  if (db) {
    return;
  }
  // SQLite creates the DB file but not its parent dir — ensure it exists so the
  // server and the test seeder are each self-sufficient (no startup ordering race).
  mkdirSync(path.dirname(db_path()), { recursive: true });
  db = new DatabaseSync(db_path());
  create_schema(db);
};

export const get_db = (): DatabaseSync => {
  init_db();
  return db;
};
