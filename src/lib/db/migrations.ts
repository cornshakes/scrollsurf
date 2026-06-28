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
  {
    version: 5,
    name: 'unify_feed_items',
    up: (db) => {
      db.exec(`
        DROP VIEW IF EXISTS feed_items;

        ALTER TABLE articles RENAME TO _old_articles;
        ALTER TABLE pictures RENAME TO _old_pictures;

        CREATE TABLE items (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          type  TEXT    NOT NULL,
          title TEXT    NOT NULL,
          url   TEXT    NOT NULL UNIQUE
        );

        INSERT INTO items (type, title, url) SELECT 'article', title, url FROM _old_articles;
        INSERT INTO items (type, title, url) SELECT 'picture', title, url FROM _old_pictures;

        CREATE TABLE articles (
          item_id     INTEGER PRIMARY KEY REFERENCES items(id),
          extract     TEXT NOT NULL,
          description TEXT,
          image_url   TEXT
        );

        CREATE TABLE pictures (
          item_id   INTEGER PRIMARY KEY REFERENCES items(id),
          image_url TEXT NOT NULL,
          caption   TEXT NOT NULL DEFAULT '',
          credit    TEXT
        );

        CREATE TABLE item_topics (
          item_id INTEGER NOT NULL REFERENCES items(id),
          dataset TEXT    NOT NULL,
          topic   TEXT    NOT NULL,
          PRIMARY KEY (item_id, dataset, topic)
        );

        CREATE TABLE item_categories (
          item_id     INTEGER NOT NULL REFERENCES items(id),
          category_id INTEGER NOT NULL REFERENCES categories(id),
          PRIMARY KEY (item_id, category_id)
        );

        CREATE TABLE user_items (
          user_id INTEGER NOT NULL REFERENCES users(id),
          item_id INTEGER NOT NULL REFERENCES items(id),
          like    INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, item_id)
        ) STRICT;

        INSERT INTO articles (item_id, extract, description, image_url)
          SELECT i.id, o.extract, o.description, o.image_url
          FROM _old_articles o JOIN items i ON i.url = o.url;

        INSERT INTO pictures (item_id, image_url, caption, credit)
          SELECT i.id, o.image_url, o.caption, o.credit
          FROM _old_pictures o JOIN items i ON i.url = o.url;

        INSERT INTO item_topics (item_id, dataset, topic)
          SELECT i.id, at.dataset, at.topic
          FROM article_topics at JOIN _old_articles o ON o.id = at.article_id JOIN items i ON i.url = o.url;

        INSERT INTO item_topics (item_id, dataset, topic)
          SELECT i.id, pt.dataset, pt.topic
          FROM picture_topics pt JOIN _old_pictures o ON o.id = pt.picture_id JOIN items i ON i.url = o.url;

        INSERT INTO item_categories (item_id, category_id)
          SELECT i.id, ac.category_id
          FROM article_categories ac JOIN _old_articles o ON o.id = ac.article_id JOIN items i ON i.url = o.url;

        INSERT INTO user_items (user_id, item_id, like)
          SELECT ua.user_id, i.id, ua.like
          FROM user_articles ua JOIN _old_articles o ON o.id = ua.article_id JOIN items i ON i.url = o.url;

        INSERT INTO user_items (user_id, item_id, like)
          SELECT up.user_id, i.id, up.like
          FROM user_pictures up JOIN _old_pictures o ON o.id = up.picture_id JOIN items i ON i.url = o.url;

        DELETE FROM user_clicks
          WHERE item_type = 'article'
            AND NOT EXISTS (SELECT 1 FROM _old_articles o WHERE o.id = user_clicks.item_id);

        DELETE FROM user_clicks
          WHERE item_type = 'picture'
            AND NOT EXISTS (SELECT 1 FROM _old_pictures o WHERE o.id = user_clicks.item_id);

        UPDATE user_clicks
          SET item_id = (
            SELECT i.id FROM _old_articles o JOIN items i ON i.url = o.url
            WHERE o.id = user_clicks.item_id
          )
          WHERE item_type = 'article';

        UPDATE user_clicks
          SET item_id = (
            SELECT i.id FROM _old_pictures o JOIN items i ON i.url = o.url
            WHERE o.id = user_clicks.item_id
          )
          WHERE item_type = 'picture';

        DROP TABLE user_articles;
        DROP TABLE user_pictures;
        DROP TABLE article_topics;
        DROP TABLE picture_topics;
        DROP TABLE article_categories;
        DROP TABLE _old_articles;
        DROP TABLE _old_pictures;

        CREATE INDEX idx_item_topics_item ON item_topics(item_id);
        CREATE INDEX idx_items_type ON items(type);
        CREATE INDEX idx_user_items_user ON user_items(user_id);
      `);
    },
  },
  {
    version: 6,
    name: 'add_quotes_table',
    up: (db) => {
      db.exec(`
        CREATE TABLE quotes (
          item_id    INTEGER PRIMARY KEY REFERENCES items(id),
          author     TEXT NOT NULL,
          author_url TEXT
        );
      `);
    },
  },
  {
    version: 7,
    name: 'add_quotes_author_image',
    up: (db) => {
      db.exec('ALTER TABLE quotes ADD COLUMN author_image TEXT');
    },
  },
  {
    version: 8,
    name: 'add_user_items_updated_at',
    up: (db) => {
      db.exec('ALTER TABLE user_items ADD COLUMN updated_at INTEGER');
    },
  },
  {
    version: 9,
    name: 'add_quotes_quote_year',
    up: (db) => {
      db.exec('ALTER TABLE quotes ADD COLUMN quote_year TEXT');
    },
  },
  {
    version: 10,
    name: 'add_topic_buckets',
    up: (db) => {
      db.exec(`
        CREATE TABLE topic_buckets (
          dataset TEXT NOT NULL,
          topic   TEXT NOT NULL,
          bucket  TEXT NOT NULL,
          PRIMARY KEY (dataset, topic)
        );
      `);
    },
  },
  {
    version: 11,
    name: 'add_user_email',
    up: (db) => {
      db.exec(`
        ALTER TABLE users ADD COLUMN email TEXT;
        CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
      `);
    },
  },
  {
    version: 12,
    name: 'add_tokens',
    up: (db) => {
      // cookie_token has an implicit UNIQUE auto-index; SQLite won't let us
      // DROP COLUMN on it, so we rebuild users via CREATE+DROP+RENAME.
      //
      // We must DROP the old users table rather than renaming it away, because
      // SQLite 3.26+ auto-updates FK references when a table is renamed: if we
      // rename users→_old, the tokens table (just created with REFERENCES
      // users(id)) would be silently rewritten to REFERENCES _old(id), breaking
      // it once _old is dropped. Dropping users (with foreign_keys=OFF) leaves
      // the FK text unchanged; renaming _users_new→users makes all existing
      // REFERENCES users(id) resolve correctly. Runner holds foreign_keys = OFF.
      db.exec(`
        CREATE TABLE tokens (
          token          TEXT PRIMARY KEY,
          user_id        INTEGER NOT NULL REFERENCES users(id),
          created_at     INTEGER NOT NULL,
          last_active_at INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX idx_tokens_user ON tokens(user_id);
        CREATE INDEX idx_tokens_last_active ON tokens(last_active_at);
        INSERT INTO tokens (token, user_id, created_at, last_active_at)
          SELECT cookie_token, id, created_at, last_active_at FROM users WHERE cookie_token IS NOT NULL;

        CREATE TABLE _users_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          email          TEXT,
          created_at     INTEGER NOT NULL,
          last_active_at INTEGER NOT NULL
        ) STRICT;
        INSERT INTO _users_new (id, email, created_at, last_active_at)
          SELECT id, email, created_at, last_active_at FROM users;
        DROP TABLE users;
        ALTER TABLE _users_new RENAME TO users;

        CREATE INDEX idx_users_last_active ON users(last_active_at);
        CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
      `);
    },
  },
  {
    version: 13,
    name: 'add_login_codes',
    up: (db) => {
      db.exec(`
        CREATE TABLE login_codes (
          email      TEXT NOT NULL PRIMARY KEY,
          code       TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        ) STRICT;
      `);
    },
  },
  {
    version: 14,
    name: 'add_login_code_attempts',
    up: (db) => {
      db.exec('ALTER TABLE login_codes ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
    },
  },
];
