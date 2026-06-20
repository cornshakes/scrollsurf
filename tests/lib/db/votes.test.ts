import {
  setup,
  insert_user,
  insert_article,
  insert_picture,
  insert_quote,
  reset_db,
} from '../../helpers/test-db';
import { get_db } from '@/lib/db/connection';
import { save_vote, record_click, get_voted_items } from '@/lib/db/votes';

beforeAll(setup);
beforeEach(reset_db);

describe('save_vote', () => {
  it('inserts a new like row', () => {
    const uid = insert_user();
    const id = insert_article({ url: 'https://a' });
    save_vote(uid, id, 1);
    const row = get_db()
      .prepare('SELECT like FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(uid, id) as { like: number };
    expect(row.like).toBe(1);
  });

  it('upsert: a second vote updates the existing row instead of inserting', () => {
    const uid = insert_user();
    const id = insert_article({ url: 'https://a' });
    save_vote(uid, id, 1);
    save_vote(uid, id, -1);
    const rows = get_db()
      .prepare('SELECT like FROM user_items WHERE user_id = ? AND item_id = ?')
      .all(uid, id) as { like: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].like).toBe(-1);
  });

  it('a neutral vote (0) is stored', () => {
    const uid = insert_user();
    const id = insert_article({ url: 'https://a' });
    save_vote(uid, id, 1);
    save_vote(uid, id, 0);
    const row = get_db()
      .prepare('SELECT like FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(uid, id) as { like: number };
    expect(row.like).toBe(0);
  });

  it('stamps updated_at and refreshes it on re-vote', () => {
    const uid = insert_user();
    const id = insert_article({ url: 'https://a' });

    const now_spy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000 * 1000);
    save_vote(uid, id, 1);
    const first = get_db()
      .prepare('SELECT updated_at FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(uid, id) as { updated_at: number };
    expect(first.updated_at).toBe(1_000_000);

    now_spy.mockReturnValue(1_000_050 * 1000);
    save_vote(uid, id, -1);
    const second = get_db()
      .prepare('SELECT updated_at FROM user_items WHERE user_id = ? AND item_id = ?')
      .get(uid, id) as { updated_at: number };
    expect(second.updated_at).toBe(1_000_050);

    now_spy.mockRestore();
  });

  it('votes are scoped per user', () => {
    const user_a = insert_user();
    const user_b = insert_user();
    const id = insert_article({ url: 'https://a' });
    save_vote(user_a, id, 1);
    save_vote(user_b, id, -1);
    expect(get_voted_items(1, user_a).map((item) => item.id)).toEqual([id]);
    expect(get_voted_items(-1, user_b).map((item) => item.id)).toEqual([id]);
    expect(get_voted_items(-1, user_a)).toHaveLength(0);
  });
});

describe('get_voted_items', () => {
  it('returns liked items and excludes disliked and neutral ones', () => {
    const uid = insert_user();
    const liked = insert_article({ url: 'https://liked' });
    const disliked = insert_article({ url: 'https://disliked' });
    const neutral = insert_article({ url: 'https://neutral' });
    save_vote(uid, liked, 1);
    save_vote(uid, disliked, -1);
    save_vote(uid, neutral, 0);
    expect(get_voted_items(1, uid).map((item) => item.id)).toEqual([liked]);
  });

  it('returns disliked items for vote -1', () => {
    const uid = insert_user();
    const id = insert_article({ url: 'https://a' });
    save_vote(uid, id, -1);
    const result = get_voted_items(-1, uid);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(id);
  });

  it('merges all item types and orders by id DESC', () => {
    const uid = insert_user();
    const article_id = insert_article({ url: 'https://a' });
    const picture_id = insert_picture({ image_url: 'https://img', url: 'https://p' });
    const quote_id = insert_quote({ text: 'Q', url: 'https://q', author: 'A' });
    save_vote(uid, article_id, 1);
    save_vote(uid, picture_id, 1);
    save_vote(uid, quote_id, 1);
    const result = get_voted_items(1, uid);
    expect(result.map((item) => item.id)).toEqual([quote_id, picture_id, article_id]);
    expect(result.map((item) => item.type)).toEqual(['quote', 'picture', 'article']);
  });

  it('orders by most-recently-voted first regardless of item id', () => {
    const uid = insert_user();
    const first = insert_article({ url: 'https://first' });
    const second = insert_article({ url: 'https://second' });
    const third = insert_article({ url: 'https://third' });

    // Vote out of id order, with advancing timestamps a second apart.
    const now_spy = jest.spyOn(Date, 'now').mockReturnValue(2_000_000 * 1000);
    save_vote(uid, second, 1);
    now_spy.mockReturnValue(2_000_001 * 1000);
    save_vote(uid, first, 1);
    now_spy.mockReturnValue(2_000_002 * 1000);
    save_vote(uid, third, 1);
    now_spy.mockRestore();

    expect(get_voted_items(1, uid).map((item) => item.id)).toEqual([third, first, second]);
  });

  it('returns an empty array when the user has voted on nothing', () => {
    const uid = insert_user();
    insert_article({ url: 'https://a' });
    expect(get_voted_items(1, uid)).toHaveLength(0);
  });
});

describe('record_click', () => {
  it('appends a click row with all fields', () => {
    const uid = insert_user();
    const id = insert_article({ url: 'https://a' });
    record_click('article', id, 'title', 'Some title', uid);
    const row = get_db().prepare('SELECT * FROM user_clicks WHERE user_id = ?').get(uid) as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      user_id: uid,
      item_type: 'article',
      item_id: id,
      link_type: 'title',
      link_label: 'Some title',
    });
    expect(typeof row.created_at).toBe('number');
  });

  it('allows a null link_label', () => {
    const uid = insert_user();
    const id = insert_picture({ image_url: 'https://img', url: 'https://p' });
    record_click('picture', id, 'title', null, uid);
    const row = get_db()
      .prepare('SELECT link_label FROM user_clicks WHERE user_id = ?')
      .get(uid) as { link_label: string | null };
    expect(row.link_label).toBeNull();
  });

  it('is append-only: repeated clicks add new rows', () => {
    const uid = insert_user();
    const id = insert_quote({ text: 'Q', url: 'https://q', author: 'A' });
    record_click('quote', id, 'topic', 'Quote of the Day', uid);
    record_click('quote', id, 'by', 'A', uid);
    record_click('quote', id, 'topic', 'Quote of the Day', uid);
    const count = get_db()
      .prepare('SELECT COUNT(*) AS count FROM user_clicks WHERE user_id = ?')
      .get(uid) as { count: number };
    expect(count.count).toBe(3);
  });
});
