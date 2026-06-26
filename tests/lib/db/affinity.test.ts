import {
  setup,
  reset_db,
  insert_user,
  insert_article,
  insert_picture,
  insert_topic_bucket,
} from '../../helpers/test-db';
import { get_next_feed } from '@/lib/db/feed';
import { record_click, save_vote } from '@/lib/db/votes';
import type { Article, Picture } from '@/lib/db/types';

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
    save_vote(uid, x_ids[i], 1);
  }
  const result = get_articles(100, uid);
  const x_count = result.filter((a) =>
    a.links.some((l) => l.type === 'topic' && l.title === 'X')
  ).length;
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
    save_vote(uid, y_ids[i], -1);
  }
  const result = get_articles(100, uid);
  const y_count = result.filter((a) =>
    a.links.some((l) => l.type === 'topic' && l.title === 'Y')
  ).length;
  expect(y_count).toBeLessThan(35);

  // deterministic: single article in a heavily-disliked topic still returned at limit >= pool
  const uid2 = insert_user();
  const disliked: number[] = [];
  for (let i = 0; i < 20; i++) {
    disliked.push(insert_article({ url: `https://a.det/${i}`, topics: [TOPIC_Y] }));
  }
  const lone = insert_article({ url: 'https://a.det/lone', topics: [TOPIC_Y] });
  for (const id of disliked) {
    save_vote(uid2, id, -1);
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
    save_vote(uid, x_ids[i], 0);
    record_click('article', x_ids[i], 'title', null, uid);
  }
  const result = get_articles(100, uid);
  const x_count = result.filter((a) =>
    a.links.some((l) => l.type === 'topic' && l.title === 'X')
  ).length;
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
      save_vote(other, id, 1);
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
    save_vote(uid_a, x_ids[i], 1);
  }
  const result = get_articles(100, uid_b);
  const x_count = result.filter((a) =>
    a.links.some((l) => l.type === 'topic' && l.title === 'X')
  ).length;
  expect(x_count).toBeGreaterThan(35);
  expect(x_count).toBeLessThan(65);
});

// statistical: pool is 180 D1/H + 200 D2/H = 380; D1/H boosted → D1/H ~82, D2/H < 35
it('isolation: likes on D1/History do not boost D2/History without a bucket mapping (statistical)', () => {
  const uid = insert_user();
  const D1H = { dataset: 'D1', topic: 'History' };
  const D2H = { dataset: 'D2', topic: 'History' };
  const d1h_ids: number[] = [];
  for (let i = 0; i < 200; i++) {
    d1h_ids.push(insert_article({ url: `https://iso.d1h/${i}`, topics: [D1H] }));
    insert_article({ url: `https://iso.d2h/${i}`, topics: [D2H] });
  }
  for (let i = 0; i < 20; i++) {
    save_vote(uid, d1h_ids[i], 1);
  }
  const result = get_articles(100, uid);
  const d2h_count = result.filter((a) =>
    a.links.some((l) => l.type === 'dataset' && l.title === 'D2')
  ).length;
  // D2/History resolves to a different fallback bucket (D2␟History) — must not be boosted
  expect(d2h_count).toBeLessThan(35);
});

// statistical: both D1/H and D2/H share bucket 'History'; both boosted → D2H > 35
it('merge: likes on D1/History boost D2/History when mapped to the same bucket (statistical)', () => {
  const uid = insert_user();
  const D1H = { dataset: 'D1', topic: 'History' };
  const D2H = { dataset: 'D2', topic: 'History' };
  insert_topic_bucket('D1', 'History', 'History');
  insert_topic_bucket('D2', 'History', 'History');
  const d1h_ids: number[] = [];
  for (let i = 0; i < 200; i++) {
    d1h_ids.push(insert_article({ url: `https://mrg.d1h/${i}`, topics: [D1H] }));
    insert_article({ url: `https://mrg.d2h/${i}`, topics: [D2H] });
  }
  for (let i = 0; i < 20; i++) {
    save_vote(uid, d1h_ids[i], 1);
  }
  const result = get_articles(100, uid);
  const d2h_count = result.filter((a) =>
    a.links.some((l) => l.type === 'dataset' && l.title === 'D2')
  ).length;
  // D2/History shares bucket 'History' with D1/History — cross-dataset boost must be present
  expect(d2h_count).toBeGreaterThan(35);
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
    save_vote(uid, x_ids[i], 1);
  }
  const x_id_set = new Set(x_ids);
  const result = get_pictures(100, uid);
  const x_count = result.filter((p) => x_id_set.has(p.id)).length;
  expect(x_count).toBeGreaterThan(65);
});
