import { setup, insert_user, insert_article, reset_db } from '../../helpers/test-db';
import { get_db } from '@/lib/db/connection';
import { get_next_feed } from '@/lib/db/feed';
import type { Article } from '@/lib/db/types';

beforeAll(setup);
beforeEach(reset_db);

const get_next_articles = (count: number, uid: number | null): Article[] =>
  get_next_feed(count, uid).filter((row): row is Article => row.type === 'article');

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
  const a1 = result.find((article) => article.id === id1) as Article;
  const a2 = result.find((article) => article.id === id2) as Article;
  expect(a1.topics.map((t) => t.topic).sort()).toEqual(['T1', 'T2']);
  expect(a1.categories).toEqual(['Science']);
  expect(a2.topics.map((t) => t.topic)).toEqual(['T3']);
  expect(a2.categories.sort()).toEqual(['Arts', 'History']);
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
    bucket: 'Science::Physics',
    dataset_url: null,
  });
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
