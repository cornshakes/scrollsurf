import { type FeedItem } from './types';
import { get_db } from './connection';
import { hydrate_feed_items } from './feed';

export const get_voted_items = (vote: -1 | 1, user_id: number): FeedItem[] => {
  const rows = get_db()
    .prepare(
      `SELECT i.type, i.id
      FROM items i
      JOIN user_items ui ON ui.item_id = i.id
      WHERE ui.like = $like AND ui.user_id = $user_id
      ORDER BY ui.updated_at DESC, i.id DESC`
    )
    .all({ $like: vote, $user_id: user_id }) as unknown as {
    type: 'article' | 'picture' | 'quote';
    id: number;
  }[];

  return hydrate_feed_items(rows, user_id);
};

export const save_vote = (user_id: number, id: number, value: -1 | 0 | 1) => {
  get_db()
    .prepare(
      `INSERT INTO user_items (user_id, item_id, like, updated_at)
      VALUES ($user_id, $item_id, $like, $updated_at)
      ON CONFLICT(user_id, item_id) DO UPDATE SET
        like = excluded.like,
        updated_at = excluded.updated_at`
    )
    .run({
      $user_id: user_id,
      $item_id: id,
      $like: value,
      $updated_at: Math.floor(Date.now() / 1000),
    });
};

export const record_click = (item_id: number, url: string, user_id: number) => {
  get_db()
    .prepare(
      `INSERT INTO user_clicks (user_id, item_id, url, created_at)
      VALUES ($user_id, $item_id, $url, $created_at)`
    )
    .run({
      $user_id: user_id,
      $item_id: item_id,
      $url: url,
      $created_at: Math.floor(Date.now() / 1000),
    });
};
