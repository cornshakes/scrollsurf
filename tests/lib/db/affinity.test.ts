import {
  setup,
  reset_db,
  insert_user,
  insert_article,
  insert_picture,
  set_like,
} from '../../helpers/test-db';
import { get_next_feed } from '@/lib/db/feed';
import { record_click } from '@/lib/db/votes';
import type { Article, FeedItem, Picture } from '@/lib/db/types';

beforeAll(setup);
beforeEach(reset_db);

const TOPIC_X = { dataset: 'D', topic: 'X' };
const TOPIC_Y = { dataset: 'D', topic: 'Y' };

const get_articles = (count: number, uid: number | null): Article[] =>
  get_next_feed(count, uid).filter((r): r is Article => r.type === 'article');

const get_pictures = (count: number, uid: number | null): Picture[] =>
  get_next_feed(count, uid).filter((r): r is Picture => r.type === 'picture');

// statistical: measured mean ≈ 82, sd ≈ 5; threshold > 65 is non-flaky
it('liked topic is over-represented in fetch (statistical)', () => {
  const uid = insert_user();
  const x_ids: number[] = [];
  for (let i = 0; i < 200; i++) {
    x_ids.push(insert_article({ url: `https://a.t1.x/${i}`, topics: [TOPIC_X] }));
    insert_article({ url: `https://a.t1.y/${i}`, topics: [TOPIC_Y] });
  }
  for (let i = 0; i < 20; i++) {
    set_like(uid, x_ids[i], 1);
  }
  const result = get_articles(100, uid);
  const x_count = result.filter((a) => a.topics.some((t) => t.topic === 'X')).length;
  expect(x_count).toBeGreaterThan(65);
});

it('disliked topic is under-represented and never fully excluded (statistical + deterministic)', () => {
  // statistical: measured mean Y-count ≈ 15; threshold < 35 is non-flaky
  const uid = insert_user();
  const y_ids: number[] = [];
  for (let i = 0; i < 200; i++) {
    insert_article({ url: `https://a.t2.x/${i}`, topics: [TOPIC_X] });
    y_ids.push(insert_article({ url: `https://a.t2.y/${i}`, topics: [TOPIC_Y] }));
  }
  for (let i = 0; i < 20; i++) {
    set_like(uid, y_ids[i], -1);
  }
  const result = get_articles(100, uid);
  const y_count = result.filter((a) => a.topics.some((t) => t.topic === 'Y')).length;
  expect(y_count).toBeLessThan(35);

  // deterministic: single article in a heavily-disliked topic still returned at limit >= pool
  const uid2 = insert_user();
  const disliked: number[] = [];
  for (let i = 0; i < 20; i++) {
    disliked.push(insert_article({ url: `https://a.det/${i}`, topics: [TOPIC_Y] }));
  }
  const lone = insert_article({ url: 'https://a.det/lone', topics: [TOPIC_Y] });
  for (const id of disliked) {
    set_like(uid2, id, -1);
  }
  const all = get_articles(5000, uid2);
  expect(all.some((a) => a.id === lone)).toBe(true);
});

// statistical: measured mean X-count ≈ 67; threshold > 55 is non-flaky
it('clicks alone boost a topic (statistical)', () => {
  const uid = insert_user();
  const x_ids: number[] = [];
  for (let i = 0; i < 200; i++) {
    x_ids.push(insert_article({ url: `https://a.t3.x/${i}`, topics: [TOPIC_X] }));
    insert_article({ url: `https://a.t3.y/${i}`, topics: [TOPIC_Y] });
  }
  for (let i = 0; i < 20; i++) {
    set_like(uid, x_ids[i], 0);
    record_click('article', x_ids[i], 'title', null, uid);
  }
  const result = get_articles(100, uid);
  const x_count = result.filter((a) => a.topics.some((t) => t.topic === 'X')).length;
  expect(x_count).toBeGreaterThan(55);
});

it('neutral user with zero signals gets all articles (deterministic)', () => {
  const uid = insert_user();
  for (let i = 0; i < 50; i++) {
    insert_article({ url: `https://a.t4/${i}`, topics: [{ dataset: 'D', topic: 'T' }] });
  }
  const result = get_articles(50, uid);
  expect(result).toHaveLength(50);
});

it('anonymous user gets all articles and nothing is marked seen', () => {
  const other = insert_user();
  for (let i = 0; i < 10; i++) {
    const id = insert_article({ url: `https://a.t5/${i}`, topics: [{ dataset: 'D', topic: 'T' }] });
    if (i < 5) {
      set_like(other, id, 1);
    }
  }
  const r1 = get_articles(20, null);
  expect(r1).toHaveLength(10);
  const r2 = get_articles(20, null);
  expect(r2).toHaveLength(10); // nothing was marked seen by anonymous
});

// statistical: user B has no signals → near-uniform; 35–65 is a ~3σ bound
it('likes from user A do not skew user B feed (statistical)', () => {
  const uid_a = insert_user();
  const uid_b = insert_user();
  const x_ids: number[] = [];
  for (let i = 0; i < 200; i++) {
    x_ids.push(insert_article({ url: `https://a.t6.x/${i}`, topics: [TOPIC_X] }));
    insert_article({ url: `https://a.t6.y/${i}`, topics: [TOPIC_Y] });
  }
  for (let i = 0; i < 20; i++) {
    set_like(uid_a, x_ids[i], 1);
  }
  const result = get_articles(100, uid_b);
  const x_count = result.filter((a) => a.topics.some((t) => t.topic === 'X')).length;
  expect(x_count).toBeGreaterThan(35);
  expect(x_count).toBeLessThan(65);
});

// statistical: measured mean ≈ 82, sd ≈ 5; threshold > 65 is non-flaky
it('pictures: liked topic is over-represented in fetch (statistical)', () => {
  const uid = insert_user();
  const x_ids: number[] = [];
  for (let i = 0; i < 200; i++) {
    x_ids.push(
      insert_picture({ url: `https://p.t7.x/${i}`, image_url: 'https://img/x', topics: [TOPIC_X] })
    );
    insert_picture({ url: `https://p.t7.y/${i}`, image_url: 'https://img/y', topics: [TOPIC_Y] });
  }
  for (let i = 0; i < 20; i++) {
    set_like(uid, x_ids[i], 1);
  }
  const x_id_set = new Set(x_ids);
  const result = get_pictures(100, uid);
  const x_count = result.filter((p) => x_id_set.has(p.id)).length;
  expect(x_count).toBeGreaterThan(65);
});

// statistical: with strength=0 all weights are 1 → pure ES-uniform; near-50/50 despite likes.
// Expected X-count ≈ 47 (180 X out of 380 pool), sd ≈ 4; 35–65 is a ~3σ non-flaky bound.
describe('AFFINITY_STRENGTH=0', () => {
  let feed_zero: (count: number, user_id: number | null) => FeedItem[];

  beforeEach(async () => {
    process.env.FEED_AFFINITY_STRENGTH = '0';
    jest.resetModules();
    const m = await import('@/lib/db/feed');
    feed_zero = m.get_next_feed;
    delete process.env.FEED_AFFINITY_STRENGTH;
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('produces near-uniform results despite likes (statistical + deterministic)', () => {
    const x_ids: number[] = [];
    for (let i = 0; i < 200; i++) {
      x_ids.push(insert_article({ url: `https://a.t8.x/${i}`, topics: [TOPIC_X] }));
      insert_article({ url: `https://a.t8.y/${i}`, topics: [TOPIC_Y] });
    }

    // deterministic: all 380 unseen articles returned even with likes present
    const uid_a = insert_user();
    for (let i = 0; i < 20; i++) {
      set_like(uid_a, x_ids[i], 1);
    }
    const all = feed_zero(5000, uid_a).filter((r): r is Article => r.type === 'article');
    expect(all).toHaveLength(380);

    // statistical: near-50/50 X/Y despite 20 liked X articles
    const uid_b = insert_user();
    for (let i = 0; i < 20; i++) {
      set_like(uid_b, x_ids[i], 1);
    }
    const result = feed_zero(100, uid_b).filter((r): r is Article => r.type === 'article');
    const x_count = result.filter((a) => a.topics.some((t) => t.topic === 'X')).length;
    expect(x_count).toBeGreaterThan(35);
    expect(x_count).toBeLessThan(65);
  });
});
