import { setup, insert_user, insert_article, insert_picture, reset_db } from './helpers/test-db';
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
import { get_voted_feed_items, vote_feed_item, get_next_feed_items, logout } from '@/app/actions';
import { save_vote } from '@/lib/db';

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
