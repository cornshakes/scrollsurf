import {
  setup,
  cleanup,
  reset,
  insert_user,
  insert_article,
  insert_picture,
  set_like as db_set_like,
} from './helpers/test-db';

// Mock user and headers before importing the actions module
jest.mock('@/lib/user', () => ({ current_user_id: jest.fn() }));
jest.mock('next/headers', () => ({
  cookies: jest.fn().mockResolvedValue({
    set: jest.fn(),
    delete: jest.fn(),
  }),
}));

import { current_user_id } from '@/lib/user';
import {
  get_voted_wiki_articles,
  set_article_like as action_set_like,
  get_next_wiki_articles,
} from '@/app/actions';

const mock_uid = current_user_id as jest.Mock;
const topic = [{ dataset: 'D', topic: 'T' }];

beforeAll(setup);
afterAll(cleanup);
beforeEach(() => {
  reset();
  mock_uid.mockReset();
});

it('get_voted_wiki_articles merges articles and pictures sorted by id DESC', async () => {
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

  db_set_like('article', id_a3, uid, 1);
  db_set_like('picture', id_p2, uid, 1);

  const result = await get_voted_wiki_articles(1);
  // id_a3 = 3, id_p2 = 2 → sorted DESC: 3, 2
  expect(result.map((x) => x.id)).toEqual([id_a3, id_p2]);
});

it('get_voted_wiki_articles returns [] when user_id is null', async () => {
  mock_uid.mockResolvedValue(null);
  expect(await get_voted_wiki_articles(1)).toEqual([]);
});

it('set_article_like returns early without writing when user_id is null', async () => {
  mock_uid.mockResolvedValue(null);
  const id = insert_article({ title: 'A', url: 'https://a', topics: topic });
  await action_set_like('article', id, 1);

  // No like row should have been written — voted list is empty
  const uid = insert_user();
  mock_uid.mockResolvedValue(uid);
  expect(await get_voted_wiki_articles(1)).toHaveLength(0);
});

it('get_next_wiki_articles returns feed items for authenticated user', async () => {
  const uid = insert_user();
  mock_uid.mockResolvedValue(uid);

  insert_article({ title: 'A', url: 'https://a', topics: topic });
  insert_article({ title: 'B', url: 'https://b', topics: topic });

  const result = await get_next_wiki_articles(10);
  expect(result.length).toBeGreaterThanOrEqual(1);
});

it('get_next_wiki_articles works for unauthenticated user (null uid)', async () => {
  mock_uid.mockResolvedValue(null);

  insert_article({ title: 'A', url: 'https://a', topics: topic });

  const result = await get_next_wiki_articles(10);
  expect(result).toHaveLength(1);
});
