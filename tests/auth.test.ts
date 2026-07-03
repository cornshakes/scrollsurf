import { DatabaseSync } from 'node:sqlite';
import { get_db } from '@/lib/db/connection';
import { reset_db, setup, insert_user, insert_article } from './helpers/test-db';
import {
  create_login_code,
  verify_login_code,
  cleanup_expired_login_codes,
  get_user_email,
  unlink_email,
  attach_login,
} from '@/lib/db/auth';
import { get_or_create_user, delete_token } from '@/lib/db/users';
import { migrate } from '@/lib/db/migrate';
import { migrations } from '@/lib/db/migrations';

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

beforeAll(setup);
beforeEach(reset_db);

const insert_user_with_email = (email: string, token: string): number => {
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

describe('create_login_code / verify_login_code', () => {
  test('valid code verifies and is deleted (single-use)', () => {
    const db = get_db();
    const email = 'user@example.com';
    const code = create_login_code(email);

    expect(typeof code).toBe('string');
    expect(code).toHaveLength(6);
    expect(verify_login_code(email, code)).toBe(true);

    // Code row deleted — single-use
    const row = db.prepare('SELECT code FROM login_codes WHERE email = ?').get(email);
    expect(row).toBeUndefined();

    // Trying the same code again fails
    expect(verify_login_code(email, code)).toBe(false);
  });

  test('wrong code returns false', () => {
    const email = 'user@example.com';
    const code = create_login_code(email);
    const wrong = code === '000000' ? '000001' : '000000';
    expect(verify_login_code(email, wrong)).toBe(false);
  });

  test('expired code returns false', () => {
    const db = get_db();
    const email = 'user@example.com';
    const code = create_login_code(email);
    const past = Math.floor(Date.now() / 1000) - 1000;
    db.prepare('UPDATE login_codes SET expires_at = ? WHERE email = ?').run(past, email);
    expect(verify_login_code(email, code)).toBe(false);
  });

  test('upsert replaces a previous code for the same email', () => {
    const db = get_db();
    const email = 'user@example.com';

    create_login_code(email);
    // Make the first code appear old so the rate-limit guard lets the next one through
    const old_time = Math.floor(Date.now() / 1000) - 61;
    db.prepare('UPDATE login_codes SET created_at = ? WHERE email = ?').run(old_time, email);

    const code2 = create_login_code(email);

    // Only one row exists (upsert replaced the old one)
    const rows = db.prepare('SELECT code FROM login_codes WHERE email = ?').all(email) as {
      code: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(verify_login_code(email, code2)).toBe(true);
  });

  test('normalizes email (trim + lowercase)', () => {
    const code = create_login_code('  User@Example.COM  ');
    expect(verify_login_code('user@example.com', code)).toBe(true);
  });

  test('returns false for an unknown email', () => {
    expect(verify_login_code('nobody@example.com', '123456')).toBe(false);
  });

  test('rate limit: throws when a code was created less than 60s ago', () => {
    const email = 'ratelimit@example.com';
    create_login_code(email);
    expect(() => create_login_code(email)).toThrow('rate_limit');
  });

  test('rate limit: allows a new code after 60s have elapsed', () => {
    const db = get_db();
    const email = 'ratelimit2@example.com';
    create_login_code(email);
    const old_time = Math.floor(Date.now() / 1000) - 61;
    db.prepare('UPDATE login_codes SET created_at = ? WHERE email = ?').run(old_time, email);
    expect(() => create_login_code(email)).not.toThrow();
  });
});

describe('verify_login_code brute-force protection', () => {
  const wrong_for = (code: string): string => (code === '000000' ? '000001' : '000000');

  test('code is invalidated after 5 failed attempts', () => {
    const db = get_db();
    const email = 'brute@example.com';
    const code = create_login_code(email);
    const wrong = wrong_for(code);

    // Four wrong guesses: code survives, attempt counter climbs
    for (let i = 0; i < 4; i++) {
      expect(verify_login_code(email, wrong)).toBe(false);
    }
    const row = db.prepare('SELECT attempts FROM login_codes WHERE email = ?').get(email) as {
      attempts: number;
    };
    expect(row.attempts).toBe(4);

    // Fifth wrong guess burns the code
    expect(verify_login_code(email, wrong)).toBe(false);
    expect(db.prepare('SELECT code FROM login_codes WHERE email = ?').get(email)).toBeUndefined();

    // Even the (now correct) code no longer works
    expect(verify_login_code(email, code)).toBe(false);
  });

  test('a correct guess before the limit still succeeds despite earlier failures', () => {
    const email = 'mix@example.com';
    const code = create_login_code(email);
    const wrong = wrong_for(code);

    expect(verify_login_code(email, wrong)).toBe(false);
    expect(verify_login_code(email, wrong)).toBe(false);
    expect(verify_login_code(email, code)).toBe(true);
  });

  test('requesting a fresh code resets the attempt counter', () => {
    const db = get_db();
    const email = 'reset-attempts@example.com';
    const code = create_login_code(email);
    const wrong = wrong_for(code);

    verify_login_code(email, wrong);
    verify_login_code(email, wrong);
    expect(
      (
        db.prepare('SELECT attempts FROM login_codes WHERE email = ?').get(email) as {
          attempts: number;
        }
      ).attempts
    ).toBe(2);

    // Age the row past the 60s resend window, then request a fresh code
    const old_time = Math.floor(Date.now() / 1000) - 61;
    db.prepare('UPDATE login_codes SET created_at = ? WHERE email = ?').run(old_time, email);
    create_login_code(email);

    expect(
      (
        db.prepare('SELECT attempts FROM login_codes WHERE email = ?').get(email) as {
          attempts: number;
        }
      ).attempts
    ).toBe(0);
  });
});

describe('cleanup_expired_login_codes', () => {
  test('deletes expired codes and keeps live ones', () => {
    const db = get_db();
    const live = 'live@example.com';
    const dead = 'dead@example.com';
    create_login_code(live);
    create_login_code(dead);

    const past = Math.floor(Date.now() / 1000) - 1;
    db.prepare('UPDATE login_codes SET expires_at = ? WHERE email = ?').run(past, dead);

    cleanup_expired_login_codes();

    expect(db.prepare('SELECT email FROM login_codes WHERE email = ?').get(dead)).toBeUndefined();
    expect(db.prepare('SELECT email FROM login_codes WHERE email = ?').get(live)).toBeDefined();
  });
});

describe('migration v12: tokens table', () => {
  test('tokens table exists and users.cookie_token is gone after full migration', () => {
    const db = get_db();

    const tok_table = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tokens'")
      .get() as { name: string } | undefined;
    expect(tok_table?.name).toBe('tokens');

    const columns = db.prepare("SELECT name FROM pragma_table_info('users')").all() as {
      name: string;
    }[];
    expect(columns.map((col) => col.name)).not.toContain('cookie_token');
  });

  test('v12 migrates existing cookie_token rows into the tokens table', () => {
    const mem = new DatabaseSync(':memory:');

    const v11 = migrations.filter((m) => m.version <= 11);
    migrate(mem, v11);

    const now = Math.floor(Date.now() / 1000);
    const token_value = 'old-cookie-token-abc';
    mem
      .prepare('INSERT INTO users (cookie_token, created_at, last_active_at) VALUES (?, ?, ?)')
      .run(token_value, now, now);
    const user_id = (mem.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id;

    // Also insert a user with no token (NULL)
    mem.prepare('INSERT INTO users (created_at, last_active_at) VALUES (?, ?)').run(now, now);

    migrate(mem, migrations);

    const tok = mem.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token_value) as
      { user_id: number } | undefined;
    expect(tok?.user_id).toBe(user_id);

    const columns = mem.prepare("SELECT name FROM pragma_table_info('users')").all() as {
      name: string;
    }[];
    expect(columns.map((col) => col.name)).not.toContain('cookie_token');

    const all_users = mem.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    expect(all_users.count).toBe(2);

    mem.close();
  });
});

describe('get_or_create_user against tokens', () => {
  test('unknown token creates a new users row and a tokens row', () => {
    const db = get_db();
    const token = 'brand-new-token-abc';
    const uid = get_or_create_user(token);

    expect(typeof uid).toBe('number');

    const user_row = db.prepare('SELECT id FROM users WHERE id = ?').get(uid) as
      { id: number } | undefined;
    expect(user_row?.id).toBe(uid);

    const token_row = db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token) as
      { user_id: number } | undefined;
    expect(token_row?.user_id).toBe(uid);
  });

  test('known token returns the same user_id and updates last_active_at', () => {
    const db = get_db();
    const token = 'known-token-abc';

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-01T00:00:00Z'));

    const uid = get_or_create_user(token);
    const first_ts = (
      db.prepare('SELECT last_active_at FROM tokens WHERE token = ?').get(token) as {
        last_active_at: number;
      }
    ).last_active_at;

    jest.setSystemTime(new Date('2024-06-01T00:01:00Z'));
    const uid2 = get_or_create_user(token);
    const second_ts = (
      db.prepare('SELECT last_active_at FROM tokens WHERE token = ?').get(token) as {
        last_active_at: number;
      }
    ).last_active_at;

    expect(uid2).toBe(uid);
    expect(second_ts).toBeGreaterThan(first_ts);

    jest.useRealTimers();
  });
});

describe('delete_token', () => {
  test('removes the token row but keeps the user and its history', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);
    const token = 'logout-token';
    const uid = insert_user(token);
    const item = insert_article({ url: 'https://logout-article' });
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(uid, item, 1, now);

    delete_token(token);

    // Token no longer resolves to the account
    expect(db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token)).toBeUndefined();
    // User row and vote history survive
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(uid)).toBeDefined();
    const votes = db
      .prepare('SELECT COUNT(*) as count FROM user_items WHERE user_id = ?')
      .get(uid) as { count: number };
    expect(votes.count).toBe(1);
  });

  test('deleting an unknown token is a no-op', () => {
    expect(() => delete_token('does-not-exist')).not.toThrow();
  });
});

describe('attach_login', () => {
  test('already this account: returns current_token, no new token row', () => {
    const db = get_db();
    const email = 'same@example.com';
    const current_token = 'current-same-account';
    const uid = insert_user_with_email(email, current_token);

    const result = attach_login(email, current_token, 'unused-new-token');

    expect(result).toBe(current_token);
    expect(
      db.prepare('SELECT user_id FROM tokens WHERE token = ?').get('unused-new-token')
    ).toBeUndefined();
    const tok = db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(current_token) as {
      user_id: number;
    };
    expect(tok.user_id).toBe(uid);
  });

  test('merge anon → account: account vote wins, anon-only items land on account, clicks moved, all anon tokens repointed, anon user deleted', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);

    const email = 'account@example.com';
    const account_token = 'account-main-token';
    const account_uid = insert_user_with_email(email, account_token);

    // Anonymous user with two browser tokens
    const anon_primary_token = 'anon-token-primary';
    const anon_second_token = 'anon-token-second';
    const anon_uid = insert_user(anon_primary_token);
    db.prepare(
      'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
    ).run(anon_second_token, anon_uid, now, now);

    // Items
    const shared_item = insert_article({ url: 'https://shared' });
    const account_only_item = insert_article({ url: 'https://account-only' });
    const anon_only_item = insert_article({ url: 'https://anon-only' });

    // Account vote on shared (like=1) — authoritative
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(account_uid, shared_item, 1, now);
    // Anon vote on shared (like=-1) — should be dropped on conflict
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(anon_uid, shared_item, -1, now);
    // Account vote on account-only item
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(account_uid, account_only_item, 1, now);
    // Anon vote on anon-only item
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(anon_uid, anon_only_item, 1, now);

    // Anon click
    db.prepare(
      'INSERT INTO user_clicks (user_id, item_id, url, created_at) VALUES (?, ?, ?, ?)'
    ).run(anon_uid, anon_only_item, 'https://anon-only', now);

    const result = attach_login(email, anon_primary_token, 'unused-new-token');

    expect(result).toBe(anon_primary_token);

    // Anon user row deleted
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(anon_uid)).toBeUndefined();

    // Both anon tokens now point to account
    const tok1 = db
      .prepare('SELECT user_id FROM tokens WHERE token = ?')
      .get(anon_primary_token) as { user_id: number };
    expect(tok1.user_id).toBe(account_uid);
    const tok2 = db
      .prepare('SELECT user_id FROM tokens WHERE token = ?')
      .get(anon_second_token) as { user_id: number };
    expect(tok2.user_id).toBe(account_uid);

    // Account keeps its vote on shared item (like=1, not -1)
    const shared_vote = db
      .prepare('SELECT like FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(account_uid, shared_item) as { like: number };
    expect(shared_vote.like).toBe(1);

    // Anon-only item now belongs to account
    const anon_only_vote = db
      .prepare('SELECT like FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(account_uid, anon_only_item) as { like: number };
    expect(anon_only_vote.like).toBe(1);

    // Click moved to account
    const clicks = db
      .prepare('SELECT user_id FROM user_clicks WHERE item_id = ?')
      .all(anon_only_item) as { user_id: number }[];
    expect(clicks.every((c) => c.user_id === account_uid)).toBe(true);
  });

  test('merge anon → account: account keeps its own clicks; anon clicks are added, not replaced', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);

    const email = 'clicks@example.com';
    const account_token = 'clicks-account-token';
    const account_uid = insert_user_with_email(email, account_token);

    const anon_token = 'clicks-anon-token';
    const anon_uid = insert_user(anon_token);

    const account_item = insert_article({ url: 'https://clicks-account' });
    const anon_item = insert_article({ url: 'https://clicks-anon' });

    // Account already has two clicks of its own
    db.prepare(
      'INSERT INTO user_clicks (user_id, item_id, url, created_at) VALUES (?, ?, ?, ?)'
    ).run(account_uid, account_item, 'https://clicks-account', now);
    db.prepare(
      'INSERT INTO user_clicks (user_id, item_id, url, created_at) VALUES (?, ?, ?, ?)'
    ).run(account_uid, account_item, 'https://clicks-account-category', now);

    // Anon has one click
    db.prepare(
      'INSERT INTO user_clicks (user_id, item_id, url, created_at) VALUES (?, ?, ?, ?)'
    ).run(anon_uid, anon_item, 'https://clicks-anon', now);

    attach_login(email, anon_token, 'unused-new-token');

    // Account keeps all three clicks: its own two are preserved, anon's one is added
    const account_clicks = db
      .prepare('SELECT item_id, url FROM user_clicks WHERE user_id = ? ORDER BY id')
      .all(account_uid) as { item_id: number; url: string }[];
    expect(account_clicks).toHaveLength(3);
    expect(account_clicks).toEqual([
      { item_id: account_item, url: 'https://clicks-account' },
      { item_id: account_item, url: 'https://clicks-account-category' },
      { item_id: anon_item, url: 'https://clicks-anon' },
    ]);

    // No clicks remain on the (now deleted) anon user
    const anon_clicks = db
      .prepare('SELECT COUNT(*) as count FROM user_clicks WHERE user_id = ?')
      .get(anon_uid) as { count: number };
    expect(anon_clicks.count).toBe(0);
  });

  test('switch accounts: only this browser token repointed, both accounts untouched', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);

    const target_email = 'target@example.com';
    const target_token = 'target-account-token';
    const target_uid = insert_user_with_email(target_email, target_token);

    const other_email = 'other@example.com';
    const current_token = 'other-account-token';
    const other_uid = insert_user_with_email(other_email, current_token);

    const target_item = insert_article({ url: 'https://target-item' });
    const other_item = insert_article({ url: 'https://other-item' });
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(target_uid, target_item, 1, now);
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(other_uid, other_item, 1, now);

    const result = attach_login(target_email, current_token, 'unused-new-token');

    expect(result).toBe(current_token);

    // current_token now points to target account
    const tok = db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(current_token) as {
      user_id: number;
    };
    expect(tok.user_id).toBe(target_uid);

    // Other user's row is NOT deleted (no merge)
    expect(
      db.prepare('SELECT id FROM users WHERE id = ?').get(other_uid) as { id: number } | undefined
    ).toBeDefined();

    // Both histories are untouched
    const target_vote = db
      .prepare('SELECT like FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(target_uid, target_item) as { like: number };
    expect(target_vote.like).toBe(1);
    const other_vote = db
      .prepare('SELECT like FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(other_uid, other_item) as { like: number };
    expect(other_vote.like).toBe(1);
  });

  test('no current token: new_token row created for existing account', () => {
    const db = get_db();
    const email = 'existing@example.com';
    const account_token = 'existing-account-token';
    const account_uid = insert_user_with_email(email, account_token);

    const new_token = 'brand-new-browser-token';
    const result = attach_login(email, null, new_token);

    expect(result).toBe(new_token);

    const tok = db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(new_token) as
      { user_id: number } | undefined;
    expect(tok?.user_id).toBe(account_uid);
  });

  test('first login promote: anonymous user gets email set, current_token returned', () => {
    const db = get_db();
    const email = 'newuser@example.com';
    const current_token = 'anon-promote-token';
    const anon_uid = get_or_create_user(current_token);

    const result = attach_login(email, current_token, 'unused-new-token');

    expect(result).toBe(current_token);

    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(anon_uid) as {
      email: string;
    };
    expect(user.email).toBe(email.toLowerCase());
  });

  test('first login promote: likes and clicks are carried over', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);
    const email = 'promote-history@example.com';
    const current_token = 'anon-promote-history-token';
    const anon_uid = get_or_create_user(current_token);

    const liked_item = insert_article({ url: 'https://promote-liked' });
    const disliked_item = insert_article({ url: 'https://promote-disliked' });
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(anon_uid, liked_item, 1, now);
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(anon_uid, disliked_item, -1, now);
    db.prepare(
      'INSERT INTO user_clicks (user_id, item_id, url, created_at) VALUES (?, ?, ?, ?)'
    ).run(anon_uid, liked_item, 'https://promote-liked', now);

    const result = attach_login(email, current_token, 'unused-new-token');

    expect(result).toBe(current_token);

    // Same user row was promoted, so its votes ride along untouched
    const votes = db
      .prepare('SELECT item_id, like FROM user_items WHERE user_id = ? ORDER BY item_id')
      .all(anon_uid) as { item_id: number; like: number }[];
    expect(votes).toEqual([
      { item_id: liked_item, like: 1 },
      { item_id: disliked_item, like: -1 },
    ]);

    // Clicks stay attached to the promoted user
    const clicks = db
      .prepare('SELECT item_id, url FROM user_clicks WHERE user_id = ?')
      .all(anon_uid) as { item_id: number; url: string }[];
    expect(clicks).toEqual([{ item_id: liked_item, url: 'https://promote-liked' }]);
  });
});

describe('unlink_email', () => {
  test('sets email = NULL and leaves user_items intact', () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);
    const email = 'unlink@example.com';
    const uid = insert_user_with_email(email, 'unlink-token');
    const item_id = insert_article({ url: 'https://unlink-article' });
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(uid, item_id, 1, now);

    unlink_email(uid);

    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(uid) as {
      email: string | null;
    };
    expect(user.email).toBeNull();

    const votes = db.prepare('SELECT like FROM user_items WHERE user_id = ?').all(uid) as {
      like: number;
    }[];
    expect(votes).toHaveLength(1);
    expect(votes[0].like).toBe(1);
  });
});

describe('get_user_email', () => {
  test('returns the email when set', () => {
    const email = 'email@example.com';
    const uid = insert_user_with_email(email, 'email-token');
    expect(get_user_email(uid)).toBe(email);
  });

  test('returns null for an anonymous user', () => {
    const uid = insert_user();
    expect(get_user_email(uid)).toBeNull();
  });

  test('returns null for an unknown user id', () => {
    expect(get_user_email(99999)).toBeNull();
  });
});
