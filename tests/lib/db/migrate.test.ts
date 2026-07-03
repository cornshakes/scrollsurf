import { DatabaseSync } from 'node:sqlite';
import { migrate, get_user_version } from '@/lib/db/migrate';
import { migrations, type migration } from '@/lib/db/migrations';

// Stamp a DB at a given schema version without running any migrations.
const stamp_version = (db: DatabaseSync, version: number) => {
  db.exec(`PRAGMA user_version = ${version}`);
};

// A 3-entry fake list whose `up`s record the versions they ran, in order.
const make_recording_list = () => {
  const applied: number[] = [];
  const list: migration[] = [1, 2, 3].map((version) => ({
    version,
    name: `fake_${version}`,
    up: () => {
      applied.push(version);
    },
  }));
  return { applied, list };
};

const table_names = (db: DatabaseSync): string[] => {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
    name: string;
  }[];
  return rows.map((row) => row.name);
};

const has_object = (db: DatabaseSync, name: string): boolean => {
  const row = db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(name) as
    { name: string } | undefined;
  return row !== undefined;
};

const column_names = (db: DatabaseSync, table: string): string[] => {
  const rows = db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as {
    name: string;
  }[];
  return rows.map((row) => row.name);
};

describe('migrate — runner (fake lists)', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  test('applies all migrations in order on a fresh DB', () => {
    const { applied, list } = make_recording_list();

    migrate(db, list);

    expect(applied).toEqual([1, 2, 3]);
    expect(get_user_version(db)).toBe(3);
  });

  test('applies only pending migrations on a mid-version DB', () => {
    const { applied, list } = make_recording_list();
    stamp_version(db, 1);

    migrate(db, list);

    expect(applied).toEqual([2, 3]);
    expect(get_user_version(db)).toBe(3);
  });

  test('is a no-op on an up-to-date DB', () => {
    const { applied, list } = make_recording_list();
    migrate(db, list);
    applied.length = 0;

    migrate(db, list);

    expect(applied).toEqual([]);
    expect(get_user_version(db)).toBe(3);
  });

  test('rolls back a failing migration and reports which one failed', () => {
    const boom = new Error('boom');
    const list: migration[] = [
      {
        version: 1,
        name: 'create_a',
        up: (target) => {
          target.exec('CREATE TABLE a (id INTEGER)');
        },
      },
      {
        version: 2,
        name: 'broken',
        up: (target) => {
          target.exec('CREATE TABLE half_created (id INTEGER)');
          throw boom;
        },
      },
      {
        version: 3,
        name: 'create_c',
        up: (target) => {
          target.exec('CREATE TABLE c (id INTEGER)');
        },
      },
    ];

    let caught: unknown;
    try {
      migrate(db, list);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('migration 2 (broken) failed');
    expect((caught as Error).cause).toBe(boom);
    expect(get_user_version(db)).toBe(1);
    expect(has_object(db, 'a')).toBe(true);
    expect(has_object(db, 'half_created')).toBe(false);
    expect(has_object(db, 'c')).toBe(false);
  });

  test('refuses a DB ahead of the known schema (downgrade guard)', () => {
    const { applied, list } = make_recording_list();
    stamp_version(db, 99);

    expect(() => migrate(db, list)).toThrow(
      'database is at schema version 99 but this code only knows up to 3'
    );
    expect(applied).toEqual([]);
  });

  test('rejects an invalid migration list before running any migration', () => {
    const recorded: number[] = [];
    const recorder = (version: number, name: string): migration => ({
      version,
      name,
      up: () => {
        recorded.push(version);
      },
    });

    const gap: migration[] = [recorder(1, 'a'), recorder(3, 'c')];
    const wrong_start: migration[] = [recorder(2, 'b'), recorder(3, 'c')];
    const duplicate: migration[] = [recorder(1, 'a'), recorder(1, 'a2'), recorder(2, 'b')];

    expect(() => migrate(db, gap)).toThrow(/invalid migration list/);
    expect(() => migrate(db, wrong_start)).toThrow(/invalid migration list/);
    expect(() => migrate(db, duplicate)).toThrow(/invalid migration list/);
    expect(recorded).toEqual([]);
  });

  test('restores foreign_keys = ON after both a successful and a failing run', () => {
    const { list } = make_recording_list();
    migrate(db, list);
    const after_success = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(after_success.foreign_keys).toBe(1);

    const failing: migration[] = [
      {
        version: 1,
        name: 'broken',
        up: () => {
          throw new Error('boom');
        },
      },
    ];
    const fresh = new DatabaseSync(':memory:');
    expect(() => migrate(fresh, failing)).toThrow();
    const after_failure = fresh.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(after_failure.foreign_keys).toBe(1);
    fresh.close();
  });
});

describe('migrate — real history', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  test('a fresh DB reaches the final schema', () => {
    migrate(db);

    expect(get_user_version(db)).toBe(migrations.length);

    const tables = table_names(db);
    for (const expected of [
      'items',
      'articles',
      'pictures',
      'quotes',
      'item_topics',
      'item_categories',
      'categories',
      'datasets',
      'category_hierarchy',
      'users',
      'user_items',
      'user_clicks',
    ]) {
      expect(tables).toContain(expected);
    }

    for (const removed of [
      'user_articles',
      'user_pictures',
      'article_topics',
      'picture_topics',
      'article_categories',
    ]) {
      expect(tables).not.toContain(removed);
    }

    expect(has_object(db, 'idx_users_last_active')).toBe(true);
    expect(has_object(db, 'idx_user_clicks_user')).toBe(true);
    expect(has_object(db, 'idx_item_topics_item')).toBe(true);
    expect(has_object(db, 'idx_items_type')).toBe(true);
    expect(has_object(db, 'idx_user_items_user')).toBe(true);
    expect(has_object(db, 'feed_items')).toBe(false);
    expect(has_object(db, 'user_settings')).toBe(false);

    // articles and pictures are now detail tables keyed by item_id
    expect(column_names(db, 'articles')).toContain('item_id');
    expect(column_names(db, 'articles')).not.toContain('id');
    expect(column_names(db, 'pictures')).toContain('item_id');
    expect(column_names(db, 'pictures')).toContain('caption');
    expect(column_names(db, 'pictures')).not.toContain('id');

    // quotes detail table carries the author page thumbnail (migration 7)
    expect(column_names(db, 'quotes')).toContain('author_image');
    // ...and the quote's year (migration 9)
    expect(column_names(db, 'quotes')).toContain('quote_year');

    // user_clicks logs the followed url (migration 17); the old descriptive
    // columns are gone
    expect(column_names(db, 'user_clicks')).toContain('url');
    expect(column_names(db, 'user_clicks')).toContain('item_id');
    expect(column_names(db, 'user_clicks')).not.toContain('item_type');
    expect(column_names(db, 'user_clicks')).not.toContain('link_type');
    expect(column_names(db, 'user_clicks')).not.toContain('link_label');
  });

  test('converges a legacy prod DB (user_version 0, no caption, has user_settings)', () => {
    // Build the schema as it was on the Pi before migrations existed: all baseline
    // tables, user_clicks + its index, a pictures table WITHOUT the caption column,
    // and a leftover user_settings table. user_version stays at 0.
    db.exec(`
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        extract TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        description TEXT,
        image_url TEXT
      );
      CREATE TABLE pictures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        image_url TEXT NOT NULL,
        credit TEXT
      );
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cookie_token TEXT UNIQUE,
        created_at INTEGER NOT NULL,
        last_active_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE user_clicks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        item_type TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        link_type TEXT NOT NULL,
        link_label TEXT,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX idx_user_clicks_user ON user_clicks(user_id);
      CREATE TABLE user_settings (
        user_id INTEGER NOT NULL,
        dataset TEXT NOT NULL
      );
    `);
    db.prepare('INSERT INTO pictures (title, url, image_url, credit) VALUES (?, ?, ?, ?)').run(
      'Legacy',
      'https://example.com/legacy',
      'https://example.com/legacy.jpg',
      'Someone'
    );

    expect(get_user_version(db)).toBe(0);

    migrate(db);

    expect(get_user_version(db)).toBe(migrations.length);
    expect(column_names(db, 'pictures')).toContain('caption');
    expect(has_object(db, 'user_settings')).toBe(false);
    expect(has_object(db, 'feed_items')).toBe(false);

    const row = db
      .prepare(
        `SELECT i.title, p.caption
         FROM items i JOIN pictures p ON p.item_id = i.id
         WHERE i.url = ?`
      )
      .get('https://example.com/legacy') as { title: string; caption: string };
    expect(row.title).toBe('Legacy');
    expect(row.caption).toBe('');
  });

  test('version 9 adds quote_year on top of a fully migrated v8 database', () => {
    const v8_migrations = migrations.filter((m) => m.version <= 8);
    migrate(db, v8_migrations);
    expect(get_user_version(db)).toBe(8);
    expect(column_names(db, 'quotes')).not.toContain('quote_year');

    migrate(db);

    expect(get_user_version(db)).toBe(migrations.length);
    expect(column_names(db, 'quotes')).toContain('quote_year');
  });

  test('is idempotent — running twice changes nothing and does not throw', () => {
    migrate(db);
    const version_after_first = get_user_version(db);

    expect(() => migrate(db)).not.toThrow();
    expect(get_user_version(db)).toBe(version_after_first);
  });

  test('version 5 creates items supertype and drops feed_items view', () => {
    migrate(db);

    expect(has_object(db, 'items')).toBe(true);
    expect(has_object(db, 'user_items')).toBe(true);
    expect(has_object(db, 'item_topics')).toBe(true);
    expect(has_object(db, 'item_categories')).toBe(true);
    expect(has_object(db, 'feed_items')).toBe(false);
  });

  test('version 5: items table holds both article and picture rows', () => {
    migrate(db);

    db.prepare('INSERT INTO items (type, title, url) VALUES (?, ?, ?)').run(
      'article',
      'Test Article',
      'https://example.com/article'
    );
    const art_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
    db.prepare('INSERT INTO articles (item_id, extract) VALUES (?, ?)').run(art_id, 'Extract');

    db.prepare('INSERT INTO items (type, title, url) VALUES (?, ?, ?)').run(
      'picture',
      'Test Picture',
      'https://example.com/picture'
    );
    const pic_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
    db.prepare('INSERT INTO pictures (item_id, image_url) VALUES (?, ?)').run(
      pic_id,
      'https://example.com/picture.jpg'
    );

    const rows = db.prepare('SELECT type, id FROM items').all() as {
      type: string;
      id: number;
    }[];

    expect(rows).toHaveLength(2);
    const types = rows.map((r) => r.type).sort();
    expect(types).toEqual(['article', 'picture']);
  });

  test('version 5 applies cleanly on top of a fully migrated v4 database', () => {
    const v4_migrations = migrations.filter((m) => m.version <= 4);
    migrate(db, v4_migrations);
    expect(get_user_version(db)).toBe(4);

    migrate(db);

    expect(get_user_version(db)).toBe(migrations.length);
    expect(has_object(db, 'items')).toBe(true);
    expect(has_object(db, 'feed_items')).toBe(false);
  });

  test('version 5 preserves votes, clicks, content, and topics from v4 data', () => {
    // Build a v4 schema with real data to verify the data-preservation migration.
    const v4_migrations = migrations.filter((m) => m.version <= 4);
    migrate(db, v4_migrations);
    expect(get_user_version(db)).toBe(4);

    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO users (cookie_token, created_at, last_active_at) VALUES (?, ?, ?)').run(
      'tok-1',
      now,
      now
    );
    const user_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

    db.prepare('INSERT INTO articles (title, extract, url) VALUES (?, ?, ?)').run(
      'Article One',
      'Extract one',
      'https://art.one'
    );
    const article_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

    db.prepare('INSERT INTO pictures (title, url, image_url) VALUES (?, ?, ?)').run(
      'Picture One',
      'https://pic.one',
      'https://img.one'
    );
    const picture_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

    db.prepare('INSERT INTO datasets (name, source_url) VALUES (?, ?)').run(
      'TestDS',
      'https://example.com/testds'
    );
    db.prepare('INSERT INTO article_topics (article_id, dataset, topic) VALUES (?, ?, ?)').run(
      article_id,
      'TestDS',
      'TopicA'
    );
    db.prepare('INSERT INTO picture_topics (picture_id, dataset, topic) VALUES (?, ?, ?)').run(
      picture_id,
      'TestDS',
      'TopicP'
    );

    db.prepare('INSERT INTO user_articles (user_id, article_id, like) VALUES (?, ?, ?)').run(
      user_id,
      article_id,
      1
    );
    db.prepare('INSERT INTO user_pictures (user_id, picture_id, like) VALUES (?, ?, ?)').run(
      user_id,
      picture_id,
      -1
    );

    db.prepare(
      'INSERT INTO user_clicks (user_id, item_type, item_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(user_id, 'article', article_id, 'title', now);
    db.prepare(
      'INSERT INTO user_clicks (user_id, item_type, item_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(user_id, 'picture', picture_id, 'title', now);

    // Apply v5
    migrate(db);
    expect(get_user_version(db)).toBe(migrations.length);

    // Resolve new global ids
    const art_item = db.prepare('SELECT id FROM items WHERE url = ?').get('https://art.one') as {
      id: number;
    };
    const pic_item = db.prepare('SELECT id FROM items WHERE url = ?').get('https://pic.one') as {
      id: number;
    };
    expect(art_item).toBeDefined();
    expect(pic_item).toBeDefined();

    // Votes survive in user_items with correct global ids
    const art_vote = db
      .prepare('SELECT like FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(user_id, art_item.id) as { like: number };
    expect(art_vote.like).toBe(1);
    const pic_vote = db
      .prepare('SELECT like FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(user_id, pic_item.id) as { like: number };
    expect(pic_vote.like).toBe(-1);

    // Clicks are remapped to global ids
    const clicks = db.prepare('SELECT item_id FROM user_clicks WHERE user_id = ?').all(user_id) as {
      item_id: number;
    }[];
    const click_ids = new Set(clicks.map((c) => c.item_id));
    expect(click_ids.has(art_item.id)).toBe(true);
    expect(click_ids.has(pic_item.id)).toBe(true);

    // Topics survive in item_topics
    const art_topics = db
      .prepare('SELECT topic FROM item_topics WHERE item_id = ?')
      .all(art_item.id) as { topic: string }[];
    expect(art_topics.map((t) => t.topic)).toContain('TopicA');
    const pic_topics = db
      .prepare('SELECT topic FROM item_topics WHERE item_id = ?')
      .all(pic_item.id) as { topic: string }[];
    expect(pic_topics.map((t) => t.topic)).toContain('TopicP');

    // Old tables are dropped
    expect(has_object(db, 'user_articles')).toBe(false);
    expect(has_object(db, 'user_pictures')).toBe(false);
    expect(has_object(db, '_old_articles')).toBe(false);
    expect(has_object(db, '_old_pictures')).toBe(false);
    expect(has_object(db, 'article_topics')).toBe(false);
    expect(has_object(db, 'picture_topics')).toBe(false);
  });

  test('version 12 creates tokens and rebuilds users without cookie_token', () => {
    migrate(db);

    expect(has_object(db, 'tokens')).toBe(true);
    expect(has_object(db, 'idx_tokens_user')).toBe(true);
    expect(has_object(db, 'idx_tokens_last_active')).toBe(true);

    // users keeps id/email/timestamps but loses cookie_token
    const users_columns = column_names(db, 'users');
    expect(users_columns).toEqual(
      expect.arrayContaining(['id', 'email', 'created_at', 'last_active_at'])
    );
    expect(users_columns).not.toContain('cookie_token');

    // its email and last-active indexes are rebuilt alongside the table
    expect(has_object(db, 'idx_users_email')).toBe(true);
    expect(has_object(db, 'idx_users_last_active')).toBe(true);
  });

  test('version 12 moves cookie_token into tokens and preserves users and FK refs', () => {
    // Fully migrate up to v11: users still has cookie_token + email here.
    const v11_migrations = migrations.filter((entry) => entry.version <= 11);
    migrate(db, v11_migrations);
    expect(get_user_version(db)).toBe(11);
    expect(column_names(db, 'users')).toContain('cookie_token');

    const now = Math.floor(Date.now() / 1000);
    // A user with a browser token + email, and one with no token (NULL cookie_token).
    db.prepare(
      'INSERT INTO users (cookie_token, email, created_at, last_active_at) VALUES (?, ?, ?, ?)'
    ).run('tok-1', 'a@example.com', now, now + 5);
    const tokened_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

    db.prepare(
      'INSERT INTO users (cookie_token, email, created_at, last_active_at) VALUES (?, ?, ?, ?)'
    ).run(null, null, now, now + 9);
    const tokenless_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number })
      .id;

    migrate(db);
    expect(get_user_version(db)).toBe(migrations.length);

    // The cookie_token became a tokens row pointing at the same user, carrying timestamps.
    const token_row = db
      .prepare('SELECT token, user_id, created_at, last_active_at FROM tokens WHERE token = ?')
      .get('tok-1') as {
      token: string;
      user_id: number;
      created_at: number;
      last_active_at: number;
    };
    expect(token_row.user_id).toBe(tokened_id);
    expect(token_row.created_at).toBe(now);
    expect(token_row.last_active_at).toBe(now + 5);

    // The NULL-token user produced no tokens row but survives in users.
    const token_count = db.prepare('SELECT COUNT(*) as count FROM tokens').get() as {
      count: number;
    };
    expect(token_count.count).toBe(1);
    const surviving = db.prepare('SELECT id, email FROM users WHERE id = ?').get(tokenless_id) as {
      id: number;
      email: string | null;
    };
    expect(surviving.id).toBe(tokenless_id);
    expect(surviving.email).toBeNull();

    // FK refs resolve to the rebuilt users table: a token to a real user inserts,
    // a token to a missing user is rejected (with foreign_keys back ON).
    expect(() =>
      db
        .prepare(
          'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
        )
        .run('tok-2', tokened_id, now, now)
    ).not.toThrow();
    expect(() =>
      db
        .prepare(
          'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
        )
        .run('tok-3', 999999, now, now)
    ).toThrow();
  });

  test('version 13 adds the login_codes table on top of a fully migrated v12 database', () => {
    const v12_migrations = migrations.filter((entry) => entry.version <= 12);
    migrate(db, v12_migrations);
    expect(get_user_version(db)).toBe(12);
    expect(has_object(db, 'login_codes')).toBe(false);

    migrate(db);

    expect(get_user_version(db)).toBe(migrations.length);
    expect(has_object(db, 'login_codes')).toBe(true);
    expect(column_names(db, 'login_codes')).toEqual(
      expect.arrayContaining(['email', 'code', 'expires_at', 'created_at'])
    );
  });

  test('version 13: login_codes upserts a single-row-per-email code', () => {
    migrate(db);

    const now = Math.floor(Date.now() / 1000);
    const upsert = db.prepare(
      `INSERT INTO login_codes (email, code, expires_at, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, created_at = excluded.created_at`
    );
    upsert.run('a@example.com', '111111', now + 900, now);
    upsert.run('a@example.com', '222222', now + 1800, now + 1);

    const rows = db
      .prepare('SELECT code, expires_at FROM login_codes WHERE email = ?')
      .all('a@example.com') as { code: string; expires_at: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('222222');
    expect(rows[0].expires_at).toBe(now + 1800);
  });

  test('version 15 makes user_items.updated_at NOT NULL and backfills NULLs', () => {
    // Migrate up to v14: user_items.updated_at is still nullable here.
    const v14_migrations = migrations.filter((entry) => entry.version <= 14);
    migrate(db, v14_migrations);
    expect(get_user_version(db)).toBe(14);

    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO users (created_at, last_active_at) VALUES (?, ?)').run(now, now);
    const user_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

    db.prepare('INSERT INTO items (type, title, url) VALUES (?, ?, ?)').run(
      'article',
      'A',
      'https://a.one'
    );
    const stamped_item = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number })
      .id;
    db.prepare('INSERT INTO items (type, title, url) VALUES (?, ?, ?)').run(
      'article',
      'B',
      'https://b.one'
    );
    const null_item = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

    // One row with a real timestamp, one legacy row with a NULL updated_at.
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(user_id, stamped_item, 1, now);
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(user_id, null_item, -1, null);

    migrate(db);
    expect(get_user_version(db)).toBe(migrations.length);

    // The column is now NOT NULL.
    const columns = db
      .prepare("SELECT name, `notnull` FROM pragma_table_info('user_items')")
      .all() as {
      name: string;
      notnull: number;
    }[];
    const updated_at_column = columns.find((column) => column.name === 'updated_at');
    expect(updated_at_column?.notnull).toBe(1);

    // The pre-existing timestamp is untouched; the NULL row is backfilled to
    // 2026-01-01T00:00:00Z (1767225600).
    const rows = db
      .prepare(
        'SELECT item_id, like, updated_at FROM user_items WHERE user_id = ? ORDER BY item_id'
      )
      .all(user_id) as { item_id: number; like: number; updated_at: number }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ item_id: stamped_item, like: 1, updated_at: now });
    expect(rows[1]).toMatchObject({ item_id: null_item, like: -1, updated_at: 1767225600 });

    // The index and vote data survive the rebuild; a NULL updated_at is now rejected.
    expect(has_object(db, 'idx_user_items_user')).toBe(true);
    db.prepare('INSERT INTO items (type, title, url) VALUES (?, ?, ?)').run(
      'article',
      'C',
      'https://c.one'
    );
    const new_item = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
    expect(() =>
      db
        .prepare('INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)')
        .run(user_id, new_item, 0, null)
    ).toThrow();
  });

  test('version 16 makes datasets.source_url NOT NULL', () => {
    // Migrate up to v15: datasets.source_url is still nullable here.
    const v15_migrations = migrations.filter((entry) => entry.version <= 15);
    migrate(db, v15_migrations);
    expect(get_user_version(db)).toBe(15);

    db.prepare('INSERT INTO datasets (name, source_url) VALUES (?, ?)').run(
      'Vital',
      'https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level/5'
    );

    migrate(db);
    expect(get_user_version(db)).toBe(migrations.length);

    // The column is now NOT NULL, and the existing row survives.
    const columns = db
      .prepare("SELECT name, `notnull` FROM pragma_table_info('datasets')")
      .all() as { name: string; notnull: number }[];
    const source_url_column = columns.find((column) => column.name === 'source_url');
    expect(source_url_column?.notnull).toBe(1);

    const row = db.prepare('SELECT source_url FROM datasets WHERE name = ?').get('Vital') as {
      source_url: string;
    };
    expect(row.source_url).toBe('https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level/5');

    // A NULL source_url is now rejected.
    expect(() =>
      db.prepare('INSERT INTO datasets (name, source_url) VALUES (?, ?)').run('Broken', null)
    ).toThrow();
  });

  test('version 16 throws when a dataset is missing source_url', () => {
    const v15_migrations = migrations.filter((entry) => entry.version <= 15);
    migrate(db, v15_migrations);
    expect(get_user_version(db)).toBe(15);

    // A dataset imported without a source page — the bug the migration surfaces.
    db.prepare('INSERT INTO datasets (name, source_url) VALUES (?, ?)').run('Vital', null);

    // The runner wraps the failure; the original reason is the `cause`.
    let caught: unknown;
    try {
      migrate(db);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toBe('migration 16 (datasets_source_url_not_null) failed');
    expect(((caught as Error).cause as Error).message).toMatch(
      /datasets missing source_url: Vital/
    );

    // The failed migration rolled back; the DB stays at v15.
    expect(get_user_version(db)).toBe(15);
  });

  test('version 17 changes user_clicks to store the followed url', () => {
    // Migrate up to v16: user_clicks still has item_type/link_type/link_label.
    const v16_migrations = migrations.filter((entry) => entry.version <= 16);
    migrate(db, v16_migrations);
    expect(get_user_version(db)).toBe(16);
    expect(column_names(db, 'user_clicks')).toContain('link_type');

    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO users (created_at, last_active_at) VALUES (?, ?)').run(now, now);
    const user_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

    const source_url = 'https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level/5';
    const author_url = 'https://en.wikiquote.org/wiki/Leonardo_da_Vinci';

    // An article (with a dataset + topic), a quote (with an author page), and a
    // picture — enough to exercise every link_type's url reconstruction.
    const insert_item = (type: string, title: string, url: string): number => {
      db.prepare('INSERT INTO items (type, title, url) VALUES (?, ?, ?)').run(type, title, url);
      return (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
    };
    const article_id = insert_item(
      'article',
      'Black hole',
      'https://en.wikipedia.org/wiki/Black_hole'
    );
    const quote_id = insert_item('quote', 'A quote', 'https://en.wikiquote.org/wiki/QOTD');
    const picture_id = insert_item(
      'picture',
      'A picture',
      'https://commons.wikimedia.org/wiki/File:X'
    );

    db.prepare('INSERT INTO datasets (name, source_url) VALUES (?, ?)').run('Vital', source_url);
    db.prepare('INSERT INTO item_topics (item_id, dataset, topic) VALUES (?, ?, ?)').run(
      article_id,
      'Vital',
      'People'
    );
    db.prepare('INSERT INTO quotes (item_id, author, author_url) VALUES (?, ?, ?)').run(
      quote_id,
      'Leonardo da Vinci',
      author_url
    );

    // One legacy click of each kind, in the old shape.
    const insert_click = (item: number, link_type: string, link_label: string | null) => {
      db.prepare(
        'INSERT INTO user_clicks (user_id, item_type, item_id, link_type, link_label, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(user_id, 'article', item, link_type, link_label, now);
    };
    insert_click(article_id, 'title', 'Black hole');
    insert_click(article_id, 'dataset', 'Vital');
    insert_click(article_id, 'topic', 'People');
    insert_click(article_id, 'category', 'Physics');
    insert_click(quote_id, 'by', 'Leonardo da Vinci');
    insert_click(picture_id, 'by', 'Jane Doe');

    migrate(db);
    expect(get_user_version(db)).toBe(migrations.length);

    // New shape: url present, descriptive columns gone, index rebuilt.
    const columns = column_names(db, 'user_clicks');
    expect(columns).toContain('url');
    expect(columns).not.toContain('item_type');
    expect(columns).not.toContain('link_type');
    expect(columns).not.toContain('link_label');
    expect(has_object(db, 'idx_user_clicks_user')).toBe(true);

    // url is NOT NULL now.
    const info = db
      .prepare("SELECT name, `notnull` FROM pragma_table_info('user_clicks')")
      .all() as { name: string; notnull: number }[];
    expect(info.find((column) => column.name === 'url')?.notnull).toBe(1);

    // Each click is backfilled with the url its link kind actually pointed at —
    // reconstructed from link_type + link_label, not the item's own url.
    const rows = db
      .prepare('SELECT item_id, url FROM user_clicks WHERE user_id = ? ORDER BY id')
      .all(user_id) as { item_id: number; url: string }[];
    expect(rows).toEqual([
      { item_id: article_id, url: 'https://en.wikipedia.org/wiki/Black_hole' }, // title -> item url
      { item_id: article_id, url: source_url }, // dataset -> dataset source_url
      { item_id: article_id, url: `${source_url}/People` }, // topic -> source_url + '/' + topic
      { item_id: article_id, url: 'https://en.wikipedia.org/wiki/Category:Physics' }, // category
      { item_id: quote_id, url: author_url }, // by (quote) -> author_url
      { item_id: picture_id, url: 'https://commons.wikimedia.org/wiki/User:Jane%20Doe' }, // by (picture)
    ]);

    // New inserts reject a NULL url.
    expect(() =>
      db
        .prepare('INSERT INTO user_clicks (user_id, item_id, url, created_at) VALUES (?, ?, ?, ?)')
        .run(user_id, article_id, null, now)
    ).toThrow();
  });

  test('version 17 throws when a click url cannot be reconstructed', () => {
    const v16_migrations = migrations.filter((entry) => entry.version <= 16);
    migrate(db, v16_migrations);
    expect(get_user_version(db)).toBe(16);

    const now = Math.floor(Date.now() / 1000);
    db.prepare('INSERT INTO users (created_at, last_active_at) VALUES (?, ?)').run(now, now);
    const user_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
    db.prepare('INSERT INTO items (type, title, url) VALUES (?, ?, ?)').run(
      'article',
      'Black hole',
      'https://en.wikipedia.org/wiki/Black_hole'
    );
    const item_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

    // A dataset click whose label matches no dataset — the reconstruction the
    // migration can no longer resolve, so it must throw rather than fabricate.
    db.prepare(
      'INSERT INTO user_clicks (user_id, item_type, item_id, link_type, link_label, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user_id, 'article', item_id, 'dataset', 'Gone', now);

    let caught: unknown;
    try {
      migrate(db);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toBe('migration 17 (user_clicks_store_url) failed');
    expect(((caught as Error).cause as Error).message).toMatch(/unresolvable url.*dataset: Gone/);

    // The failed migration rolled back; the DB stays at v16 with the old shape.
    expect(get_user_version(db)).toBe(16);
    expect(column_names(db, 'user_clicks')).toContain('link_type');
  });
});
