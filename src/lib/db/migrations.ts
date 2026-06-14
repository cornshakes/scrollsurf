import type { DatabaseSync } from 'node:sqlite';

// Append-only migration history for the runtime scrollsurf.db.
//
// Rules:
//   - Append only. Never edit or reorder a shipped migration — once a version
//     has run anywhere, its `up` is frozen. Add a new entry instead.
//   - Versions are contiguous starting at 1 and must match array order.
//   - No BEGIN/COMMIT inside `up`: the runner owns the transaction.
//   - No PRAGMAs that can't run inside a transaction (e.g. journal_mode,
//     foreign_keys) — those belong in connection setup, not migration history.
//   - Prepare statements per call; no module-level statement caches.

export type migration = {
  version: number; // contiguous, starting at 1
  name: string;
  up: (db: DatabaseSync) => void;
};

export const migrations: readonly migration[] = [
  {
    version: 1,
    name: 'baseline',
    up: (db) => {
      // Verbatim CREATE TABLE IF NOT EXISTS block carried over from the old
      // create_schema(). IF NOT EXISTS stays here only — it lets the existing
      // prod DB (user_version 0, tables already present) no-op through without a
      // separate detection path. Later migrations are unconditional.
      db.exec(`
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
    },
  },
  {
    version: 2,
    name: 'drop_user_settings',
    up: (db) => {
      // Per-user dataset selection was removed; clean up the table on existing DBs.
      db.exec('DROP TABLE IF EXISTS user_settings');
    },
  },
  {
    version: 3,
    name: 'add_pictures_caption',
    up: (db) => {
      // Conditional: a pre-caption prod DB no-ops through the baseline (its
      // pictures table already exists), so this is the only place the column
      // gets added to those DBs. Fresh and post-hack DBs already have it.
      const columns = db.prepare("SELECT name FROM pragma_table_info('pictures')").all() as {
        name: string;
      }[];
      const has_caption = columns.some((column) => column.name === 'caption');
      if (!has_caption) {
        db.exec("ALTER TABLE pictures ADD COLUMN caption TEXT NOT NULL DEFAULT ''");
      }
    },
  },
  {
    version: 4,
    name: 'add_feed_items_view',
    up: (db) => {
      db.exec(`
        CREATE VIEW IF NOT EXISTS feed_items AS
          SELECT 'article' AS type, id FROM articles
          UNION ALL
          SELECT 'picture' AS type, id FROM pictures;
      `);
    },
  },
];
