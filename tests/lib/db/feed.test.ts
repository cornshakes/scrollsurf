// PICTURE_RATIO is read at module load time. This test file relies on
// FEED_PICTURE_RATIO being unset (defaulting to 0.2) in the Jest environment.
// To test a different ratio, use jest.resetModules() + dynamic import in a
// separate describe block with FEED_PICTURE_RATIO set before the import.
import {
  setup,
  cleanup,
  reset,
  insert_user,
  insert_article,
  insert_picture,
} from '../../helpers/test-db';
import { get_next_feed } from '@/lib/db/feed';

beforeAll(setup);
afterAll(cleanup);
beforeEach(reset);

const topic = [{ dataset: 'D', topic: 'T' }];

const make_articles = (n: number) => {
  for (let i = 0; i < n; i++) {
    insert_article({ title: `A${i}`, url: `https://a${i}`, topics: topic });
  }
};

const make_pictures = (n: number) => {
  for (let i = 0; i < n; i++) {
    insert_picture({
      title: `P${i}`,
      url: `https://p${i}`,
      image_url: `https://img${i}`,
      topics: topic,
    });
  }
};

it('with ratio=0.2 and 10 requested, yields 2 pictures and 8 articles', () => {
  make_articles(10);
  make_pictures(5);
  const feed = get_next_feed(10, null);
  expect(feed).toHaveLength(10);
  expect(feed.filter((x) => x.type === 'picture')).toHaveLength(2);
  expect(feed.filter((x) => x.type === 'article')).toHaveLength(8);
});

it('pictures are evenly spaced (not all at front or back)', () => {
  make_articles(10);
  make_pictures(5);
  const feed = get_next_feed(10, null);
  const pic_positions = feed.map((x, i) => (x.type === 'picture' ? i : -1)).filter((i) => i >= 0);
  // With 2 pics and 8 articles, step = floor(8/3)+1 = 3; pics appear at positions 3 and 6
  expect(pic_positions[0]).toBeGreaterThan(0);
  expect(pic_positions[pic_positions.length - 1]).toBeLessThan(feed.length - 1);
});

it('backfills with extra articles when fewer pictures exist than requested', () => {
  make_articles(15);
  make_pictures(1);
  const feed = get_next_feed(10, null);
  expect(feed).toHaveLength(10);
  expect(feed.filter((x) => x.type === 'picture')).toHaveLength(1);
  expect(feed.filter((x) => x.type === 'article')).toHaveLength(9);
});

it('returns all articles when no pictures exist', () => {
  make_articles(10);
  const feed = get_next_feed(10, null);
  expect(feed).toHaveLength(10);
  expect(feed.every((x) => x.type === 'article')).toBe(true);
});

it('never exceeds count', () => {
  make_articles(50);
  make_pictures(50);
  const feed = get_next_feed(10, null);
  expect(feed).toHaveLength(10);
});

it('returns fewer items when DB has less than count', () => {
  make_articles(3);
  make_pictures(1);
  const feed = get_next_feed(10, null);
  expect(feed.length).toBeLessThan(10);
});

it('marks items seen for a logged-in user', () => {
  const uid = insert_user();
  // 8 articles + 2 pictures exactly fills one batch at ratio=0.2; second call returns empty
  make_articles(8);
  make_pictures(2);
  get_next_feed(10, uid);
  const second = get_next_feed(10, uid);
  expect(second).toHaveLength(0);
});

it('does not mark items seen for null user', () => {
  make_articles(10);
  make_pictures(5);
  get_next_feed(10, null);
  const second = get_next_feed(10, null);
  expect(second).toHaveLength(10);
});
