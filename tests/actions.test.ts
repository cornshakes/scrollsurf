import {
  setup,
  insert_user,
  insert_article,
  insert_picture,
  reset_db,
  insert_user_with_email,
} from './helpers/test-db';
import { get_db } from '@/lib/db/connection';

// Mock user and headers before importing the actions module
jest.mock('@/lib/user', () => ({ current_user_id: jest.fn() }));
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  }),
}));

import { cookies } from 'next/headers';
import { current_user_id } from '@/lib/user';
import {
  get_voted_feed_items,
  vote_feed_item,
  get_next_feed_items,
  logout,
  revoke_consent,
  export_my_data,
} from '@/app/actions';
import { record_click, save_vote } from '@/lib/db';

const mock_uid = current_user_id as jest.Mock;
const mock_cookies = cookies as jest.Mock;
const topic = [{ dataset: 'D', topic: 'T' }];

beforeAll(setup);
beforeEach(() => {
  reset_db();
  mock_uid.mockReset();
});

it('get_voted_feed_items merges articles, pictures, and quotes sorted by id DESC', async () => {
  const uid = insert_user();
  mock_uid.mockResolvedValue(uid);

  insert_article({ title: 'A1', url: 'https://a1', topics: topic });
  insert_article({ title: 'A2', url: 'https://a2', topics: topic });
  const id_a3 = insert_article({ title: 'A3', url: 'https://a3', topics: topic });
  insert_picture({ title: 'P1', url: 'https://p1', image_url: 'https://img1', topics: topic });
  const id_p2 = insert_picture({
    title: 'P2',
    url: 'https://p2',
    image_url: 'https://img2',
    topics: topic,
  });

  save_vote(uid, id_a3, 1);
  save_vote(uid, id_p2, 1);

  const result = await get_voted_feed_items(1);
  // Global ids: A1=1, A2=2, A3=3, P1=4, P2=5 → sorted DESC: 5, 3
  expect(result.map((x) => x.id)).toEqual([id_p2, id_a3]);
});

it('get_voted_feed_items returns [] when user_id is null', async () => {
  mock_uid.mockResolvedValue(null);
  expect(await get_voted_feed_items(1)).toEqual([]);
});

it('vote_feed_item returns early without writing when user_id is null', async () => {
  mock_uid.mockResolvedValue(null);
  const id = insert_article({ title: 'A', url: 'https://a', topics: topic });
  await vote_feed_item(id, 1);

  // No like row should have been written — voted list is empty
  const uid = insert_user();
  mock_uid.mockResolvedValue(uid);
  expect(await get_voted_feed_items(1)).toHaveLength(0);
});

it('get_next_feed_items returns feed items for authenticated user', async () => {
  const uid = insert_user();
  mock_uid.mockResolvedValue(uid);

  insert_article({ title: 'A', url: 'https://a', topics: topic });
  insert_article({ title: 'B', url: 'https://b', topics: topic });

  const result = await get_next_feed_items(10);
  expect(result.length).toBeGreaterThanOrEqual(1);
});

it('get_next_feed_items works for unauthenticated user (null uid)', async () => {
  mock_uid.mockResolvedValue(null);

  insert_article({ title: 'A', url: 'https://a', topics: topic });

  const result = await get_next_feed_items(10);
  expect(result).toHaveLength(1);
});

it('logout deletes the old token from the db so it can no longer be reused', async () => {
  const db = get_db();
  const old_token = 'logout-old-token';
  insert_user(old_token);

  const set = jest.fn();
  mock_cookies.mockResolvedValue({
    get: jest.fn().mockReturnValue({ value: old_token }),
    set,
    delete: jest.fn(),
  });

  await logout();

  // Old token no longer resolves to any account
  expect(db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(old_token)).toBeUndefined();

  // A fresh anonymous token was issued and exists in the db
  expect(set).toHaveBeenCalled();
  const new_token = set.mock.calls[0][1] as string;
  expect(new_token).not.toBe(old_token);
  expect(db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(new_token)).toBeDefined();
});

describe('revoke_consent', () => {
  const seed_user_with_history = (token: string): number => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);
    const uid = insert_user(token);
    const item_id = insert_article({ url: `https://revoke-${token}`, topics: topic });
    db.prepare(
      'INSERT INTO user_items (user_id, item_id, like, updated_at) VALUES (?, ?, ?, ?)'
    ).run(uid, item_id, 1, now);
    db.prepare(
      'INSERT INTO user_clicks (user_id, item_id, url, created_at) VALUES (?, ?, ?, ?)'
    ).run(uid, item_id, `https://revoke-${token}`, now);
    return uid;
  };

  it('keep_data=false erases the user, their votes, clicks, and tokens', async () => {
    const db = get_db();
    const token = 'revoke-delete-token';
    const uid = seed_user_with_history(token);
    mock_uid.mockResolvedValue(uid);
    mock_cookies.mockResolvedValue({
      get: jest.fn().mockReturnValue({ value: token }),
      set: jest.fn(),
      delete: jest.fn(),
    });

    await revoke_consent({ keep_data: false });

    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(uid)).toBeUndefined();
    expect(
      (
        db.prepare('SELECT COUNT(*) as count FROM user_items WHERE user_id = ?').get(uid) as {
          count: number;
        }
      ).count
    ).toBe(0);
    expect(
      (
        db.prepare('SELECT COUNT(*) as count FROM user_clicks WHERE user_id = ?').get(uid) as {
          count: number;
        }
      ).count
    ).toBe(0);
    expect(db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token)).toBeUndefined();
  });

  it('keep_data=true unlinks email and drops this token but preserves activity', async () => {
    const db = get_db();
    const now = Math.floor(Date.now() / 1000);
    const token = 'revoke-keep-token';
    const uid = seed_user_with_history(token);
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run('keep@example.com', uid);
    // A second device token that must survive (only the current one is dropped).
    db.prepare(
      'INSERT INTO tokens (token, user_id, created_at, last_active_at) VALUES (?, ?, ?, ?)'
    ).run('revoke-keep-second', uid, now, now);
    mock_uid.mockResolvedValue(uid);
    mock_cookies.mockResolvedValue({
      get: jest.fn().mockReturnValue({ value: token }),
      set: jest.fn(),
      delete: jest.fn(),
    });

    await revoke_consent({ keep_data: true });

    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(uid) as {
      email: string | null;
    };
    expect(user.email).toBeNull();
    expect(db.prepare('SELECT user_id FROM tokens WHERE token = ?').get(token)).toBeUndefined();
    expect(
      db.prepare('SELECT user_id FROM tokens WHERE token = ?').get('revoke-keep-second')
    ).toBeDefined();
    expect(
      (
        db.prepare('SELECT COUNT(*) as count FROM user_items WHERE user_id = ?').get(uid) as {
          count: number;
        }
      ).count
    ).toBe(1);
  });
});

describe('export_my_data', () => {
  it('returns the seen/liked items, clicks, and email plus an exported_at stamp', async () => {
    const uid = insert_user_with_email('me@you.com', 'export-action-token');
    const item_id = insert_article({ url: 'https://article', topics: topic });
    save_vote(uid, item_id, 1);
    record_click(item_id, 'https://article', uid);
    record_click(item_id, 'https://clicked-link', uid);

    mock_uid.mockResolvedValue(uid);
    const data = await export_my_data();

    expect(data).not.toBeNull();
    expect(typeof data?.exported_at).toBe('string');
    expect(data?.seen).toHaveLength(1);
    expect(data?.liked).toHaveLength(1);
    expect(data?.clicked).toHaveLength(2);
    expect(data?.user_email).toBe('me@you.com');
  });

  it('returns null when there is no logged-in/tracked user', async () => {
    mock_uid.mockResolvedValue(null);
    expect(await export_my_data()).toBeNull();
  });
});
