// PICTURE_RATIO is read at module load time. This test file relies on
// FEED_PICTURE_RATIO being unset (defaulting to 0.1) in the Jest environment.
// To test a different ratio, use jest.resetModules() + dynamic import in a
// separate describe block with FEED_PICTURE_RATIO set before the import.
import { type FeedItem } from '@/lib/db/types';
import {
  setup,
  insert_user,
  insert_article,
  insert_picture,
  reset_db,
  set_like,
} from '../../helpers/test-db';
import { get_next_feed } from '@/lib/db/feed';

beforeAll(setup);
beforeEach(reset_db);

const topic = [{ dataset: 'D', topic: 'T' }];

const make_articles = (n: number) => {
  for (let i = 0; i < n; i++) {
    insert_article({ url: `https://test.article/${i}`, topics: topic });
  }
};

const make_pictures = (n: number) => {
  for (let i = 0; i < n; i++) {
    insert_picture({
      image_url: `https://img/${i}`,
      url: `https://test.picture/${i}`,
      topics: topic,
    });
  }
};

// --- DETERMINISTIC BOUNDARY TESTS ---

it('pool smaller than count returns whole pool without duplicates', () => {
  make_articles(3);
  make_pictures(1);
  const feed = get_next_feed(10, null);
  expect(feed).toHaveLength(4);
  const keys = feed.map((x) => `${x.type}-${x.id}`);
  expect(new Set(keys).size).toBe(4);
});

it('only articles in pool returns all articles', () => {
  make_articles(5);
  const feed = get_next_feed(10, null);
  expect(feed).toHaveLength(5);
  expect(feed.every((x) => x.type === 'article')).toBe(true);
});

it('only pictures in pool returns all pictures', () => {
  make_pictures(5);
  const feed = get_next_feed(10, null);
  expect(feed).toHaveLength(5);
  expect(feed.every((x) => x.type === 'picture')).toBe(true);
});

it('result length is as defined in count', () => {
  make_articles(50);
  make_pictures(50);
  const feed = get_next_feed(10, null);
  expect(feed.length).toEqual(10);
});

it('logged-in user: second call excludes items seen in first call', () => {
  const uid = insert_user();
  make_articles(5);
  make_pictures(5);
  get_next_feed(10, uid);
  const second = get_next_feed(10, uid);
  expect(second).toHaveLength(0);
});

it('null user: nothing marked seen', () => {
  make_articles(5);
  make_pictures(5);
  get_next_feed(10, null);
  const second = get_next_feed(10, null);
  expect(second).toHaveLength(10);
});

it('items are fully hydrated with plain object literals', () => {
  insert_article({ url: 'https://hydr.article', topics: topic, categories: ['Science'] });
  insert_picture({ image_url: 'https://hydr.img', url: 'https://hydr.picture', topics: topic });
  const feed = get_next_feed(5, null);
  expect(feed.length).toBeGreaterThan(0);
  for (const item of feed) {
    expect(Object.getPrototypeOf(item)).toBe(Object.prototype);
    expect(item.topics.length).toBeGreaterThan(0);
    if (item.type === 'article') {
      expect(Array.isArray(item.categories)).toBe(true);
    }
  }
});

// --- STATISTICAL RATIO TEST ---

// Pool: 500 articles + 100 pictures; null user (no mark-seen) → independent draws.
// 50 × 20 = 1000 items; expected pics ≈ 100 (10%); sd ≈ 9.5; 3σ bounds [71, 129].
it('picture share is near FEED_PICTURE_RATIO=0.1 (statistical)', () => {
  for (let i = 0; i < 500; i++) insert_article({ url: `https://stat.a/${i}`, topics: topic });
  for (let i = 0; i < 100; i++) {
    insert_picture({ image_url: 'x', url: `https://stat.p/${i}`, topics: topic });
  }
  let pic_count = 0;
  for (let i = 0; i < 50; i++) {
    pic_count += get_next_feed(20, null).filter((x) => x.type === 'picture').length;
  }
  // statistical: measured mean ≈ 100, sd ≈ 9.5; [71, 129] is 3σ non-flaky
  expect(pic_count).toBeGreaterThan(71);
  expect(pic_count).toBeLessThan(129);
}, 30000);

// --- RATIO BOUNDARY TESTS ---

// Each describe uses beforeEach (not beforeAll) to import a fresh module instance
// per test, ensuring the new connection module always opens the post-reset_db file.

describe('FEED_PICTURE_RATIO=0', () => {
  let feed_zero: (count: number, user_id: number | null) => FeedItem[];

  beforeEach(async () => {
    process.env.FEED_PICTURE_RATIO = '0';
    jest.resetModules();
    const m = await import('@/lib/db/feed');
    feed_zero = m.get_next_feed;
    delete process.env.FEED_PICTURE_RATIO;
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('every item is an article even when pictures exist', () => {
    make_articles(5);
    make_pictures(5);
    const feed = feed_zero(10, null);
    expect(feed).toHaveLength(5);
    expect(feed.every((x) => x.type === 'article')).toBe(true);
  });
});

describe('FEED_PICTURE_RATIO=1', () => {
  let feed_one: (count: number, user_id: number | null) => FeedItem[];

  beforeEach(async () => {
    process.env.FEED_PICTURE_RATIO = '1';
    jest.resetModules();
    const m = await import('@/lib/db/feed');
    feed_one = m.get_next_feed;
    delete process.env.FEED_PICTURE_RATIO;
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('every item is a picture even when articles exist', () => {
    make_articles(5);
    make_pictures(5);
    const feed = feed_one(10, null);
    expect(feed).toHaveLength(5);
    expect(feed.every((x) => x.type === 'picture')).toBe(true);
  });

  // statistical: measured mean ≈ 82, sd ≈ 5; threshold > 65 is non-flaky
  it('liked picture topic is over-represented among pictures drawn (statistical)', () => {
    const uid = insert_user();
    const x_ids: number[] = [];
    for (let i = 0; i < 200; i++) {
      x_ids.push(
        insert_picture({
          image_url: 'xi',
          url: `https://aff.x/${i}`,
          topics: [{ dataset: 'D', topic: 'X' }],
        })
      );
      insert_picture({
        image_url: 'yi',
        url: `https://aff.y/${i}`,
        topics: [{ dataset: 'D', topic: 'Y' }],
      });
    }
    for (let i = 0; i < 20; i++) {
      set_like('picture', x_ids[i], uid, 1);
    }
    const feed = feed_one(100, uid);
    // 180 unseen X + 200 unseen Y = 380 eligible; X affinity boost pushes X above baseline ~47
    const x_count = feed.filter(
      (f) => f.type === 'picture' && f.topics.some((t) => t.topic === 'X')
    ).length;
    expect(x_count).toBeGreaterThan(65);
  });
});
