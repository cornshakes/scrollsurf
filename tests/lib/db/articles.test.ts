import {
  setup,
  insert_user,
  insert_article,
  insert_dataset,
  reset_db,
} from '../../helpers/test-db';
import { get_next_articles, set_article_like, get_voted_articles } from '@/lib/db/articles';
import { set_dataset_enabled } from '@/lib/db/settings';

beforeAll(setup);
beforeEach(reset_db);

it('returns unseen articles', () => {
  const uid = insert_user();
  insert_article({ title: 'A', url: 'https://a', topics: [{ dataset: 'D', topic: 'T' }] });
  const result = get_next_articles(10, uid);
  expect(result).toHaveLength(1);
  expect(result[0].title).toBe('A');
  expect(result[0].type).toBe('article');
});

it('excludes already-seen articles', () => {
  const uid = insert_user();
  insert_article({ title: 'A', url: 'https://a', topics: [{ dataset: 'D', topic: 'T' }] });
  get_next_articles(10, uid);
  expect(get_next_articles(10, uid)).toHaveLength(0);
});

it('marks articles seen in user_articles after fetching with user_id', () => {
  const uid = insert_user();
  insert_article({ title: 'A', url: 'https://a', topics: [{ dataset: 'D', topic: 'T' }] });
  get_next_articles(10, uid);
  expect(get_next_articles(10, uid)).toHaveLength(0);
});

it('does not mark articles seen when user_id is null', () => {
  insert_article({ title: 'A', url: 'https://a', topics: [{ dataset: 'D', topic: 'T' }] });
  get_next_articles(10, null);
  expect(get_next_articles(10, null)).toHaveLength(1);
});

it('parses |||-delimited categories correctly', () => {
  const uid = insert_user();
  insert_article({
    title: 'A',
    url: 'https://a',
    topics: [{ dataset: 'D', topic: 'T' }],
    categories: ['Science', 'History'],
  });
  const [article] = get_next_articles(10, uid);
  expect(article.categories).toHaveLength(2);
  expect(article.categories).toEqual(expect.arrayContaining(['Science', 'History']));
});

it('correctly parses topic names containing :: (e.g. Science::Physics)', () => {
  const uid = insert_user();
  insert_article({
    title: 'A',
    url: 'https://a',
    topics: [{ dataset: 'Vital', topic: 'Science::Physics' }],
  });
  const [article] = get_next_articles(10, uid);
  expect(article.topics).toHaveLength(1);
  expect(article.topics[0]).toEqual({
    dataset: 'Vital',
    topic: 'Science::Physics',
    dataset_url: null,
  });
});

it('excludes articles from a disabled dataset', () => {
  const uid = insert_user();
  insert_dataset('D');
  insert_article({ title: 'A', url: 'https://a', topics: [{ dataset: 'D', topic: 'T' }] });
  set_dataset_enabled('D', false, uid);
  expect(get_next_articles(10, uid)).toHaveLength(0);
});

it('disabled dataset does not affect other users', () => {
  const uid1 = insert_user();
  const uid2 = insert_user();
  insert_dataset('D');
  insert_article({ title: 'A', url: 'https://a', topics: [{ dataset: 'D', topic: 'T' }] });
  set_dataset_enabled('D', false, uid1);
  expect(get_next_articles(10, uid2)).toHaveLength(1);
});

it('set_article_like upsert: inserts then updates', () => {
  const uid = insert_user();
  const id = insert_article({
    title: 'A',
    url: 'https://a',
    topics: [{ dataset: 'D', topic: 'T' }],
  });

  set_article_like(id, 1, uid);
  expect(get_voted_articles(1, uid)).toHaveLength(1);

  set_article_like(id, -1, uid);
  expect(get_voted_articles(1, uid)).toHaveLength(0);
  expect(get_voted_articles(-1, uid)).toHaveLength(1);
});

it('get_voted_articles(1) returns liked articles ordered by id DESC', () => {
  const uid = insert_user();
  const id1 = insert_article({
    title: 'A',
    url: 'https://a',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  const id2 = insert_article({
    title: 'B',
    url: 'https://b',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  set_article_like(id1, 1, uid);
  set_article_like(id2, 1, uid);
  const result = get_voted_articles(1, uid);
  expect(result.map((a) => a.id)).toEqual([id2, id1]);
});

it('get_voted_articles(-1) returns disliked articles', () => {
  const uid = insert_user();
  const id = insert_article({
    title: 'A',
    url: 'https://a',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  set_article_like(id, -1, uid);
  const result = get_voted_articles(-1, uid);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe(id);
});
