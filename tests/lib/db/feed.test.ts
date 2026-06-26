import { range } from 'es-toolkit';
import {
  setup,
  insert_user,
  insert_article,
  insert_picture,
  reset_db,
  insert_quote,
} from '../../helpers/test-db';
import { get_next_feed, TYPE_SHARES } from '@/lib/db/feed';
import { save_vote } from '@/lib/db';

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

const make_quotes = (n: number) => {
  for (let i = 0; i < n; i++) {
    insert_quote({
      text: `${i} little ducks go round and round`,
      url: `https://test.quote/${i}`,
      author: 'Dan Brown',
      author_url: `https://wiki.author/${i}`,
      author_image: `https://wiki.author.image/${i}`,
    });
  }
};

describe('get_next_feed(): Without User', () => {
  it('pool smaller than count returns whole pool without duplicates', () => {
    make_articles(3);
    make_pictures(1);
    make_quotes(1);
    const feed = get_next_feed(10, null);
    expect(feed).toHaveLength(5);
    const keys = feed.map((x) => `${x.type}-${x.id}`);
    expect(new Set(keys).size).toBe(5);
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

  it('only quotes in pool returns all quotes', () => {
    make_quotes(5);
    const feed = get_next_feed(10, null);
    expect(feed).toHaveLength(5);
    expect(feed.every((x) => x.type === 'quote')).toBe(true);
  });

  it('result length is as defined in count', () => {
    make_articles(50);
    make_pictures(50);
    make_quotes(50);
    const feed = get_next_feed(10, null);
    expect(feed.length).toEqual(10);
  });

  it('result length stays the same on repeated calls', () => {
    make_articles(5);
    make_pictures(5);
    make_quotes(5);
    get_next_feed(10, null);
    const second = get_next_feed(10, null);
    expect(second).toHaveLength(10);
  });

  it('items are fully hydrated with plain object literals', () => {
    insert_article({ url: 'https://hydr.article', topics: topic, categories: ['Science'] });
    insert_picture({ image_url: 'https://hydr.img', url: 'https://hydr.picture', topics: topic });
    insert_quote({ text: 'Q', url: 'https://q', author: 'Me' });
    const feed = get_next_feed(5, null);
    expect(feed.length).toBe(3);
    for (const item of feed) {
      expect(Object.getPrototypeOf(item)).toBe(Object.prototype);
      expect(item.topics.length).toBeGreaterThan(0);
      if (item.type === 'article') {
        expect(Array.isArray(item.categories)).toBe(true);
      }
    }
  });

  it('item shares match the configured type shares (statistical-ish)', () => {
    make_articles(1000);
    make_pictures(1000);
    make_quotes(1000);

    const _2000_items = range(100).flatMap(() => get_next_feed(20, null));

    const exp_articles = TYPE_SHARES.article * 2000;
    const article_count = _2000_items.filter((i) => i.type === 'article').length;
    expect(article_count).toBeWithin(exp_articles * 0.85, exp_articles * 1.15);

    const exp_pictures = TYPE_SHARES.picture * 2000;
    const picture_count = _2000_items.filter((i) => i.type === 'picture').length;
    expect(picture_count).toBeWithin(exp_pictures * 0.85, exp_pictures * 1.15);

    const exp_quotes = TYPE_SHARES.quote * 2000;
    const quote_count = _2000_items.filter((i) => i.type === 'quote').length;
    expect(quote_count).toBeWithin(exp_quotes * 0.85, exp_quotes * 1.15);
  });
});

describe('get_next_feed(): With User', () => {
  it('second call excludes items seen in first call', () => {
    const uid = insert_user();
    make_articles(5);
    make_pictures(5);
    make_quotes(5);
    get_next_feed(10, uid);
    const second = get_next_feed(10, uid);
    expect(second).toHaveLength(5);
  });

  // --- AFFINITY TEST ---

  // Pool is pictures-only (no articles/quotes inserted), so every draw is a picture.
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
      save_vote(uid, x_ids[i], 1);
    }
    const feed = get_next_feed(100, uid);
    // 180 unseen X + 200 unseen Y = 380 eligible; X affinity boost pushes X above baseline ~47
    const x_count = feed.filter(
      (f) => f.type === 'picture' && f.topics.some((t) => t.topic === 'X')
    ).length;
    expect(x_count).toBeGreaterThan(65);
  });

  // Regression / proof: quotes all share the single 'Quote of the Day' topic, so
  // liking quotes would uniformly boost the whole quote pool and flood the feed.
  // Quote affinity strength is 0, so likes must not influence how many quotes are
  // drawn. Two users share the same pool: `liker` likes 100 quotes, `control`
  // marks the same 100 seen-but-neutral (vote 0) so both have identical eligible
  // pools — the only difference is the like signal. Their quote shares must match
  // each other and the configured type share.
  it('likes do not influence how many quotes are drawn', () => {
    make_articles(1000);
    make_pictures(1000);
    make_quotes(1000);

    const liker = insert_user();
    const control = insert_user();
    const quote_ids = range(100).map((index) =>
      insert_quote({
        text: `signal quote ${index}`,
        url: `https://signal.quote/${index}`,
        author: 'A',
      })
    );
    for (const quote_id of quote_ids) {
      save_vote(liker, quote_id, 1); // liked
      save_vote(control, quote_id, 0); // seen, neutral — keeps pools identical
    }

    const draws = 50;
    const liker_feed = range(draws).flatMap(() => get_next_feed(20, liker));
    const control_feed = range(draws).flatMap(() => get_next_feed(20, control));

    const count_quotes = (feed: typeof liker_feed) =>
      feed.filter((item) => item.type === 'quote').length;
    const liker_quotes = count_quotes(liker_feed);
    const control_quotes = count_quotes(control_feed);

    // Both stay near the configured type share — likes did not inflate quotes.
    // (Pre-fix, liker_quotes would be several times control_quotes.)
    const expected = TYPE_SHARES.quote * draws * 20;
    expect(liker_quotes).toBeWithin(expected * 0.7, expected * 1.3);
    expect(control_quotes).toBeWithin(expected * 0.7, expected * 1.3);
  });
});
