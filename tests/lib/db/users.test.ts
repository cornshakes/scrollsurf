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
  test('sets cookie_token = NULL for users older than INACTIVITY_DAYS', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);

    // Insert an old user
    db.prepare('INSERT INTO users (cookie_token, created_at, last_active_at) VALUES (?, ?, ?)').run(
      'old-token',
      now - INACTIVITY_DAYS * 86400 - 1000,
      now - INACTIVITY_DAYS * 86400 - 1000
    );

    // Insert a recent user
    db.prepare('INSERT INTO users (cookie_token, created_at, last_active_at) VALUES (?, ?, ?)').run(
      'new-token',
      now,
      now
    );

    const old_row = db.prepare('SELECT id FROM users WHERE cookie_token = ?').get('old-token') as {
      id: number;
    };
    cleanup_inactive_users();
    const after = db.prepare('SELECT cookie_token FROM users WHERE id = ?').get(old_row.id) as {
      cookie_token: string | null;
    };
    expect(after.cookie_token).toBeNull();

    const new_user = db
      .prepare('SELECT cookie_token FROM users WHERE cookie_token = ?')
      .get('new-token') as { cookie_token: string | null } | undefined;
    expect(new_user?.cookie_token).toBe('new-token');
  });

  test('leaves recent users untouched', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);

    db.prepare('INSERT INTO users (cookie_token, created_at, last_active_at) VALUES (?, ?, ?)').run(
      'recent-token',
      now,
      now
    );

    cleanup_inactive_users();

    const user = db.prepare('SELECT cookie_token FROM users WHERE id = 1').get() as {
      cookie_token: string;
    };
    expect(user.cookie_token).toBe('recent-token');
  });
});
