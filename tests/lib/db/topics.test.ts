import {
  setup,
  insert_user,
  insert_article,
  insert_picture,
  set_like,
  reset_db,
} from '../../helpers/test-db';
import { db } from '@/lib/db/connection';
import { get_topic_tree, get_category_tree } from '@/lib/db/topics';

beforeAll(setup);
beforeEach(reset_db);

const topic = (dataset: string, t: string) => ({ dataset, topic: t });

// ── get_topic_tree ───────────────────────────────────────────────────────────

it('nests topics under their dataset group', () => {
  insert_article({ title: 'A', url: 'https://a', topics: [topic('Vital', 'People')] });
  insert_article({ title: 'B', url: 'https://b', topics: [topic('Vital', 'Geography')] });
  insert_article({ title: 'C', url: 'https://c', topics: [topic('Unusual', 'Science')] });

  const tree = get_topic_tree(null);
  const vital = tree.find((g) => g.dataset === 'Vital');
  const unusual = tree.find((g) => g.dataset === 'Unusual');

  expect(vital).toBeDefined();
  expect(vital?.topics.map((t) => t.topic)).toEqual(
    expect.arrayContaining(['People', 'Geography'])
  );
  expect(unusual).toBeDefined();
  expect(unusual?.topics.map((t) => t.topic)).toEqual(['Science']);
});

it('picture topics appear as a separate dataset group', () => {
  insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [topic('Featured Pictures', 'Animals')],
  });
  insert_article({
    title: 'A',
    url: 'https://a',
    topics: [topic('Vital', 'People')],
  });

  const tree = get_topic_tree(null);
  const pic_group = tree.find((g) => g.dataset === 'Featured Pictures');
  const art_group = tree.find((g) => g.dataset === 'Vital');

  expect(pic_group).toBeDefined();
  expect(pic_group?.topics[0].topic).toBe('Animals');
  expect(art_group).toBeDefined();
});

it('liked and disliked counts per topic are correct per user', () => {
  const uid = insert_user();
  const id1 = insert_article({ title: 'A', url: 'https://a', topics: [topic('Vital', 'People')] });
  const id2 = insert_article({ title: 'B', url: 'https://b', topics: [topic('Vital', 'People')] });
  insert_article({ title: 'C', url: 'https://c', topics: [topic('Vital', 'People')] });

  set_like('article', id1, uid, 1);
  set_like('article', id2, uid, -1);

  const tree = get_topic_tree(uid);
  const vital = tree.find((g) => g.dataset === 'Vital');
  const people = vital?.topics.find((t) => t.topic === 'People');

  expect(people?.article_count).toBe(3);
  expect(people?.liked).toBe(1);
  expect(people?.disliked).toBe(1);
});

it('picture topic liked/disliked counts are correct', () => {
  const uid = insert_user();
  const id = insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [topic('Featured Pictures', 'Animals')],
  });

  set_like('picture', id, uid, 1);

  const tree = get_topic_tree(uid);
  const pic_group = tree.find((g) => g.dataset === 'Featured Pictures');
  const animals = pic_group?.topics.find((t) => t.topic === 'Animals');

  expect(animals?.liked).toBe(1);
  expect(animals?.disliked).toBe(0);
});

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
