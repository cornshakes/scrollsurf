import { setup, insert_user, insert_picture, reset_db } from '../../helpers/test-db';
import { get_next_feed } from '@/lib/db/feed';
import type { Picture } from '@/lib/db/types';

beforeAll(setup);
beforeEach(reset_db);

const get_next_pictures = (count: number, uid: number | null): Picture[] =>
  get_next_feed(count, uid).filter((row): row is Picture => row.type === 'picture');

it('batch fetch: each picture gets exactly its own topics with no cross-leak', () => {
  const uid = insert_user();
  const id1 = insert_picture({
    title: 'P1',
    url: 'https://p1',
    image_url: 'https://img1',
    topics: [
      { dataset: 'D', topic: 'T1' },
      { dataset: 'D', topic: 'T2' },
    ],
  });
  const id2 = insert_picture({
    title: 'P2',
    url: 'https://p2',
    image_url: 'https://img2',
    topics: [{ dataset: 'D', topic: 'T3' }],
  });
  const result = get_next_pictures(10, uid);
  expect(result).toHaveLength(2);
  const p1 = result.find((picture) => picture.id === id1) as Picture;
  const p2 = result.find((picture) => picture.id === id2) as Picture;
  expect(p1.topics.map((t) => t.topic).sort()).toEqual(['T1', 'T2']);
  expect(p2.topics.map((t) => t.topic)).toEqual(['T3']);
});
