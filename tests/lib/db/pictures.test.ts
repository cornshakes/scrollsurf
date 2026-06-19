import { setup, insert_user, insert_picture, reset_db } from '../../helpers/test-db';
import { get_voted_pictures } from '@/lib/db/pictures';
import { get_next_feed } from '@/lib/db/feed';
import { set_like } from '@/lib/db/votes';
import type { Picture } from '@/lib/db/types';

beforeAll(setup);
beforeEach(reset_db);

const get_next_pictures = (count: number, uid: number | null): Picture[] =>
  get_next_feed(count, uid).filter((r): r is Picture => r.type === 'picture');

it('returns unseen pictures', () => {
  const uid = insert_user();
  insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  const result = get_next_pictures(10, uid);
  expect(result).toHaveLength(1);
  expect(result[0].title).toBe('P');
  expect(result[0].type).toBe('picture');
});

it('excludes already-seen pictures', () => {
  const uid = insert_user();
  insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  get_next_pictures(10, uid);
  expect(get_next_pictures(10, uid)).toHaveLength(0);
});

it('marks pictures seen in user_items after fetching with user_id', () => {
  const uid = insert_user();
  insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  get_next_pictures(10, uid);
  expect(get_next_pictures(10, uid)).toHaveLength(0);
});

it('does not mark pictures seen when user_id is null', () => {
  insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  get_next_pictures(10, null);
  expect(get_next_pictures(10, null)).toHaveLength(1);
});

it('set_like upsert: inserts then updates', () => {
  const uid = insert_user();
  const id = insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });

  set_like(uid, id, 1);
  expect(get_voted_pictures(1, uid)).toHaveLength(1);

  set_like(uid, id, -1);
  expect(get_voted_pictures(1, uid)).toHaveLength(0);
  expect(get_voted_pictures(-1, uid)).toHaveLength(1);
});

it('get_voted_pictures(1) returns liked pictures ordered by id DESC', () => {
  const uid = insert_user();
  const id1 = insert_picture({
    title: 'P1',
    url: 'https://p1',
    image_url: 'https://img1',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  const id2 = insert_picture({
    title: 'P2',
    url: 'https://p2',
    image_url: 'https://img2',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  set_like(uid, id1, 1);
  set_like(uid, id2, 1);
  const result = get_voted_pictures(1, uid);
  expect(result.map((p) => p.id)).toEqual([id2, id1]);
});

it('get_voted_pictures(-1) returns disliked pictures', () => {
  const uid = insert_user();
  const id = insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  set_like(uid, id, -1);
  const result = get_voted_pictures(-1, uid);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe(id);
});

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
  const p1 = result.find((p) => p.id === id1) as Picture;
  const p2 = result.find((p) => p.id === id2) as Picture;
  expect(p1.topics.map((t) => t.topic).sort()).toEqual(['T1', 'T2']);
  expect(p2.topics.map((t) => t.topic)).toEqual(['T3']);
});

it('pictures appear in feed when no articles exist', () => {
  insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  const feed = get_next_feed(10, null);
  expect(feed).toHaveLength(1);
  expect(feed[0].type).toBe('picture');
});
