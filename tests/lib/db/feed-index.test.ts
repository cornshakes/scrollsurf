import { setup, reset_db, insert_article, insert_picture } from '../../helpers/test-db';
import { get_db } from '@/lib/db/connection';
import { rebuild_feed_index } from '@/lib/db/feed-index';

beforeAll(setup);
beforeEach(reset_db);

const get_set_id = (item_id: number): number => {
  const row = get_db()
    .prepare('SELECT set_id FROM bucket_set_items WHERE item_id = ?')
    .get(item_id) as { set_id: number } | undefined;
  expect(row).toBeDefined();
  return (row as { set_id: number }).set_id;
};

it('items with identical buckets share a set; different buckets get different sets', () => {
  const T1 = { dataset: 'D', topic: 'T1' };
  const T2 = { dataset: 'D', topic: 'T2' };
  const a = insert_article({ url: 'https://fi/a', topics: [T1, T2] });
  const b = insert_article({ url: 'https://fi/b', topics: [T2, T1] }); // order must not matter
  const c = insert_article({ url: 'https://fi/c', topics: [T1] });
  rebuild_feed_index();

  expect(get_set_id(a)).toBe(get_set_id(b));
  expect(get_set_id(c)).not.toBe(get_set_id(a));
});

it('throws on an item that is not mapped to any topic_bucket', () => {
  insert_article({ url: 'https://fi/unmapped', topics: [{ dataset: 'D', topic: 'T' }] }, false);
  get_db().exec('DELETE FROM topic_buckets');
  expect(rebuild_feed_index).toThrow();
});

it('bucket_set_counts counts items per (type, set)', () => {
  const T = { dataset: 'D', topic: 'T' };
  insert_article({ url: 'https://fi/a1', topics: [T] });
  insert_article({ url: 'https://fi/a2', topics: [T] });
  insert_picture({ url: 'https://fi/p1', image_url: 'https://img/1', topics: [T] });
  rebuild_feed_index();

  const counts = get_db()
    .prepare('SELECT type, item_count FROM bucket_set_counts ORDER BY type')
    .all() as {
    type: string;
    item_count: number;
  }[];
  expect(counts).toEqual([
    { type: 'article', item_count: 2 },
    { type: 'picture', item_count: 1 },
  ]);
});

it('rebuild reflects new items and leaves no stale rows', () => {
  const T = { dataset: 'D', topic: 'T' };
  insert_article({ url: 'https://fi/a1', topics: [T] });
  rebuild_feed_index();
  const before = get_db().prepare('SELECT COUNT(*) AS n FROM bucket_set_items').get() as {
    n: number;
  };
  expect(before.n).toBe(1);

  insert_article({ url: 'https://fi/a2', topics: [{ dataset: 'D', topic: 'Other' }] });
  rebuild_feed_index();

  const after = get_db().prepare('SELECT COUNT(*) AS n FROM bucket_set_items').get() as {
    n: number;
  };
  expect(after.n).toBe(2);
  const set_count = get_db().prepare('SELECT COUNT(*) AS n FROM bucket_set_counts').get() as {
    n: number;
  };
  expect(set_count.n).toBe(2);
});
