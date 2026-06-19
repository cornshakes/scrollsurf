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
    | { name: string }
    | undefined;
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

    db.prepare('INSERT INTO datasets (name) VALUES (?)').run('TestDS');
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
});
