import { type LinkType } from './types';
import { get_db } from './connection';

const RECORD_CLICK_SQL = `
  INSERT INTO user_clicks (user_id, item_type, item_id, link_type, link_label, created_at)
  VALUES ($user_id, $item_type, $item_id, $link_type, $link_label, $created_at)
`;

const SET_LIKE_SQL = `
  INSERT INTO user_items (user_id, item_id, like) VALUES ($user_id, $item_id, $like)
  ON CONFLICT(user_id, item_id) DO UPDATE SET like = excluded.like
`;

export const set_like = (user_id: number, id: number, value: -1 | 0 | 1) => {
  get_db().prepare(SET_LIKE_SQL).run({ $user_id: user_id, $item_id: id, $like: value });
};

export const record_click = (
  item_type: 'article' | 'picture',
  item_id: number,
  link_type: LinkType,
  link_label: string | null,
  user_id: number
) => {
  get_db()
    .prepare(RECORD_CLICK_SQL)
    .run({
      $user_id: user_id,
      $item_type: item_type,
      $item_id: item_id,
      $link_type: link_type,
      $link_label: link_label,
      $created_at: Math.floor(Date.now() / 1000),
    });
};
