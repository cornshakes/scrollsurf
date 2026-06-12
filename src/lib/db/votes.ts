import { type LinkType } from './types';
import { get_db } from './connection';
import { set_article_like } from './articles';
import { set_picture_like } from './pictures';

const RECORD_CLICK_SQL = `
  INSERT INTO user_clicks (user_id, item_type, item_id, link_type, link_label, created_at)
  VALUES ($user_id, $item_type, $item_id, $link_type, $link_label, $created_at)
`;

export const set_like = (
  type: 'article' | 'picture',
  id: number,
  value: -1 | 0 | 1,
  user_id: number
) => {
  if (type === 'article') {
    set_article_like(id, value, user_id);
  } else {
    set_picture_like(id, value, user_id);
  }
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
