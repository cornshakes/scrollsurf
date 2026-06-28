import { get_db } from '@/lib/db/connection';
import { reset_db, setup } from '../../helpers/test-db';
import { get_or_create_user, cleanup_inactive_users } from '@/lib/db/users';

// Mock environment
const INACTIVITY_DAYS = 14;

beforeAll(() => {
  setup();
  process.env.USER_INACTIVITY_DAYS = String(INACTIVITY_DAYS);
});

beforeEach(reset_db);

afterAll(() => {
  delete process.env.USER_INACTIVITY_DAYS;
});

// Mock the cookie module
jest.mock('@/lib/cookie', () => ({
  INACTIVITY_DAYS: 14,
  COOKIE_NAME: 'ss_uid',
  COOKIE_MAX_AGE: 14 * 24 * 60 * 60,
  cookie_options: () => ({
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 14 * 24 * 60 * 60,
  }),
  CONSENT_COOKIE: 'ss_consent',
  CONSENT_MAX_AGE: 180 * 24 * 60 * 60,
  consent_cookie_options: () => ({
    httpOnly: false,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 180 * 24 * 60 * 60,
  }),
}));

describe('get_or_create_user', () => {
  test('called twice with the same token returns the same id', () => {
    const token = 'test-token-123';

    const id1 = get_or_create_user(token);
    const id2 = get_or_create_user(token);

    expect(id1).toBe(id2);
  });

  test('creates a tokens row for an unknown token', () => {
    const db = get_db();
    const token = 'brand-new-token';
    const uid = get_or_create_user(token);

    const row = db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token) as
      { user_id: number } | undefined;
    expect(row?.user_id).toBe(uid);
  });

  test('updates last_active_at on the second call', () => {
    const db = get_db();
    const token = 'test-token-456';
    jest.useFakeTimers();

    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    const id = get_or_create_user(token);
    const row1 = db.prepare('SELECT last_active_at FROM users WHERE id = ?').get(id) as {
      last_active_at: number;
    };

    jest.setSystemTime(new Date('2024-01-01T00:00:10Z'));
    get_or_create_user(token);
    const row2 = db.prepare('SELECT last_active_at FROM users WHERE id = ?').get(id) as {
      last_active_at: number;
    };

    expect(row2.last_active_at).toBeGreaterThan(row1.last_active_at);

    jest.useRealTimers();
  });
});

describe('cleanup_inactive_users', () => {
  test('deletes tokens older than INACTIVITY_DAYS', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);

    // Insert an old user with an old token
    db.prepare('INSERT INTO users (created_at, last_active_at) VALUES (?, ?)').run(
      now - INACTIVITY_DAYS * 86400 - 1000,
      now - INACTIVITY_DAYS * 86400 - 1000
    );
    const old_user_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
    db.prepare(
      'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
    ).run(
      'old-token',
      old_user_id,
      now - INACTIVITY_DAYS * 86400 - 1000,
      now - INACTIVITY_DAYS * 86400 - 1000
    );

    // Insert a recent user with a recent token
    db.prepare('INSERT INTO users (created_at, last_active_at) VALUES (?, ?)').run(now, now);
    const new_user_id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
    db.prepare(
      'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
    ).run('new-token', new_user_id, now, now);

    cleanup_inactive_users();

    const old_tok = db.prepare('SELECT token FROM tokens WHERE token = ?').get('old-token');
    expect(old_tok).toBeUndefined();

    const new_tok = db.prepare('SELECT token FROM tokens WHERE token = ?').get('new-token') as
      { token: string } | undefined;
    expect(new_tok?.token).toBe('new-token');
  });

  test('leaves recent tokens untouched', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);

    db.prepare('INSERT INTO users (created_at, last_active_at) VALUES (?, ?)').run(now, now);
    const uid = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;
    db.prepare(
      'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
    ).run('recent-token', uid, now, now);

    cleanup_inactive_users();

    const tok = db.prepare('SELECT token FROM tokens WHERE token = ?').get('recent-token') as
      { token: string } | undefined;
    expect(tok?.token).toBe('recent-token');
  });
});
