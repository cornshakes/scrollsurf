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
      'articles',
      'categories',
      'article_categories',
      'article_topics',
      'datasets',
      'category_hierarchy',
      'pictures',
      'picture_topics',
      'users',
      'user_articles',
      'user_pictures',
      'user_clicks',
    ]) {
      expect(tables).toContain(expected);
    }

    expect(has_object(db, 'idx_users_last_active')).toBe(true);
    expect(has_object(db, 'idx_user_clicks_user')).toBe(true);
    expect(column_names(db, 'pictures')).toContain('caption');
    expect(has_object(db, 'user_settings')).toBe(false);
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

    const row = db
      .prepare('SELECT title, caption FROM pictures WHERE url = ?')
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
});
