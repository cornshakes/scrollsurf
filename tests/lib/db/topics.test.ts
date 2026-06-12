import { setup, insert_user, insert_article, set_like, reset_db } from '../../helpers/test-db';
import { db } from '@/lib/db/connection';
import { get_category_tree } from '@/lib/db/topics';

beforeAll(setup);
beforeEach(reset_db);

const topic = (dataset: string, t: string) => ({ dataset, topic: t });

// ── get_category_tree ────────────────────────────────────────────────────────

const insert_category_hierarchy = (category_name: string, top_level: string) => {
  db.prepare(
    'INSERT OR IGNORE INTO category_hierarchy (category_name, top_level) VALUES (?, ?)'
  ).run(category_name, top_level);
};

it('get_category_tree nests categories under top-level groups', () => {
  insert_article({
    title: 'A',
    url: 'https://a',
    topics: [topic('D', 'T')],
    categories: ['Physics'],
  });
  insert_category_hierarchy('Physics', 'Science');

  const tree = get_category_tree(null);
  const science = tree.find((g) => g.top_level === 'Science');
  expect(science).toBeDefined();
  expect(science?.categories.map((c) => c.topic)).toContain('Physics');
});

it('category article counts are correct when article belongs to multiple categories', () => {
  insert_article({
    title: 'A',
    url: 'https://a',
    topics: [topic('D', 'T')],
    categories: ['Physics', 'Maths'],
  });
  insert_category_hierarchy('Physics', 'Science');
  insert_category_hierarchy('Maths', 'Science');

  const tree = get_category_tree(null);
  const science = tree.find((g) => g.top_level === 'Science');
  expect(science?.article_count).toBe(1);

  const physics = science?.categories.find((c) => c.topic === 'Physics');
  const maths = science?.categories.find((c) => c.topic === 'Maths');
  expect(physics?.article_count).toBe(1);
  expect(maths?.article_count).toBe(1);
});

it('category liked/disliked counts are per user', () => {
  const uid = insert_user();
  const id = insert_article({
    title: 'A',
    url: 'https://a',
    topics: [topic('D', 'T')],
    categories: ['Physics'],
  });
  insert_category_hierarchy('Physics', 'Science');
  set_like('article', id, uid, 1);

  const tree = get_category_tree(uid);
  const science = tree.find((g) => g.top_level === 'Science');
  const physics = science?.categories.find((c) => c.topic === 'Physics');
  expect(physics?.liked).toBe(1);
  expect(physics?.disliked).toBe(0);
});
