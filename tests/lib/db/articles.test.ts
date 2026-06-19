import { setup, insert_user, insert_article, reset_db } from '../../helpers/test-db';
import { get_db } from '@/lib/db/connection';
import { get_next_feed } from '@/lib/db/feed';
import { get_voted_articles } from '@/lib/db/articles';
import { set_like } from '@/lib/db/votes';
import type { Article } from '@/lib/db/types';

beforeAll(setup);
beforeEach(reset_db);

const get_next_articles = (count: number, uid: number | null): Article[] =>
  get_next_feed(count, uid).filter((r): r is Article => r.type === 'article');

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

it('marks articles seen in user_items after fetching with user_id', () => {
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

it('returns all visible categories', () => {
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

it('topic names containing :: round-trip intact (regression: value is never parsed)', () => {
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

it('set_like upsert: inserts then updates', () => {
  const uid = insert_user();
  const id = insert_article({
    title: 'A',
    url: 'https://a',
    topics: [{ dataset: 'D', topic: 'T' }],
  });

  set_like(uid, id, 1);
  expect(get_voted_articles(1, uid)).toHaveLength(1);

  set_like(uid, id, -1);
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
  set_like(uid, id1, 1);
  set_like(uid, id2, 1);
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
  set_like(uid, id, -1);
  const result = get_voted_articles(-1, uid);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe(id);
});

it('batch fetch: each article gets exactly its own topics and categories with no cross-leak', () => {
  const uid = insert_user();
  const id1 = insert_article({
    title: 'A1',
    url: 'https://a1',
    topics: [
      { dataset: 'D', topic: 'T1' },
      { dataset: 'D', topic: 'T2' },
    ],
    categories: ['Science'],
  });
  const id2 = insert_article({
    title: 'A2',
    url: 'https://a2',
    topics: [{ dataset: 'D', topic: 'T3' }],
    categories: ['History', 'Arts'],
  });
  const result = get_next_articles(10, uid);
  expect(result).toHaveLength(2);
  const a1 = result.find((a) => a.id === id1) as Article;
  const a2 = result.find((a) => a.id === id2) as Article;
  expect(a1.topics.map((t) => t.topic).sort()).toEqual(['T1', 'T2']);
  expect(a1.categories).toEqual(['Science']);
  expect(a2.topics.map((t) => t.topic)).toEqual(['T3']);
  expect(a2.categories.sort()).toEqual(['Arts', 'History']);
});

it('dataset_url is populated when datasets.source_url is set, null when absent', () => {
  const uid = insert_user();
  insert_article({
    title: 'A',
    url: 'https://a',
    topics: [
      { dataset: 'WithUrl', topic: 'T1' },
      { dataset: 'NoUrl', topic: 'T2' },
    ],
  });
  get_db()
    .prepare('UPDATE datasets SET source_url = ? WHERE name = ?')
    .run('https://example.com/dataset', 'WithUrl');
  const [article] = get_next_articles(10, uid);
  const withUrl = article.topics.find(
    (t) => t.dataset === 'WithUrl'
  ) as (typeof article.topics)[number];
  const noUrl = article.topics.find(
    (t) => t.dataset === 'NoUrl'
  ) as (typeof article.topics)[number];
  expect(withUrl.dataset_url).toBe('https://example.com/dataset');
  expect(noUrl.dataset_url).toBeNull();
});

it('hidden categories are excluded from article results', () => {
  const uid = insert_user();
  insert_article({
    title: 'A',
    url: 'https://a',
    topics: [{ dataset: 'D', topic: 'T' }],
    categories: ['Visible'],
  });
  const db = get_db();
  db.prepare('INSERT OR IGNORE INTO categories (name, hidden) VALUES (?, 1)').run('Hidden');
  const hidden_id = (
    db.prepare('SELECT id FROM categories WHERE name = ?').get('Hidden') as { id: number }
  ).id;
  const item_id = (db.prepare('SELECT id FROM items WHERE title = ?').get('A') as { id: number })
    .id;
  db.prepare('INSERT INTO item_categories (item_id, category_id) VALUES (?, ?)').run(
    item_id,
    hidden_id
  );
  const [article] = get_next_articles(10, uid);
  expect(article.categories).toEqual(['Visible']);
  expect(article.categories).not.toContain('Hidden');
});
