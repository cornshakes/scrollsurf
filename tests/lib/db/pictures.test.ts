import { setup, insert_user, insert_picture, reset_db } from '../../helpers/test-db';
import { get_voted_pictures, set_picture_like } from '@/lib/db/pictures';
import { get_next_feed } from '@/lib/db/feed';

// get_next_pictures_internal is not exported — test it via get_next_feed with
// FEED_PICTURE_RATIO=1 would require module reset; instead call get_next_feed
// with only pictures in the DB (no articles) so it returns pictures.
// For simpler isolation, we import and re-export an internal for direct testing:
import { get_next_pictures_internal } from '@/lib/db/pictures';

beforeAll(setup);
beforeEach(reset_db);

it('returns unseen pictures', () => {
  const uid = insert_user();
  insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  const result = get_next_pictures_internal(10, uid);
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
  get_next_pictures_internal(10, uid);
  expect(get_next_pictures_internal(10, uid)).toHaveLength(0);
});

it('marks pictures seen after fetching with user_id', () => {
  const uid = insert_user();
  insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  get_next_pictures_internal(10, uid);
  expect(get_next_pictures_internal(10, uid)).toHaveLength(0);
});

it('does not mark pictures seen when user_id is null', () => {
  insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });
  get_next_pictures_internal(10, null);
  expect(get_next_pictures_internal(10, null)).toHaveLength(1);
});

it('set_picture_like upsert: inserts then updates', () => {
  const uid = insert_user();
  const id = insert_picture({
    title: 'P',
    url: 'https://p',
    image_url: 'https://img',
    topics: [{ dataset: 'D', topic: 'T' }],
  });

  set_picture_like(id, 1, uid);
  expect(get_voted_pictures(1, uid)).toHaveLength(1);

  set_picture_like(id, -1, uid);
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
  set_picture_like(id1, 1, uid);
  set_picture_like(id2, 1, uid);
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
  set_picture_like(id, -1, uid);
  const result = get_voted_pictures(-1, uid);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe(id);
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
