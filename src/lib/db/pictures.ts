import { type Picture } from './types';
import { get_db } from './connection';
import { affinity_ctes, weighted_random_order_by } from './affinity';

type PictureDbRow = Omit<Picture, 'type'>;

const row_to_picture = (r: PictureDbRow): Picture => ({
  type: 'picture',
  id: r.id,
  title: r.title,
  url: r.url,
  like: r.like,
  image_url: r.image_url,
  caption: r.caption,
  credit: r.credit,
});

const PICTURE_AFFINITY_CTES = affinity_ctes({
  topics_table: 'picture_topics',
  user_table: 'user_pictures',
  item_id_col: 'picture_id',
  item_type: 'picture',
});

const PICTURE_GET_NEXT_SQL = (order_by: string) => `
  ${PICTURE_AFFINITY_CTES}
  SELECT p.id, p.title, p.url, p.image_url, p.caption, p.credit,
         COALESCE(up.like, 0) AS like
  FROM pictures p
  LEFT JOIN user_pictures up ON p.id = up.picture_id AND up.user_id = $user_id
  LEFT JOIN item_affinity ia ON ia.item_id = p.id
  WHERE up.picture_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM picture_topics pt
      LEFT JOIN user_settings us ON us.dataset = pt.dataset AND us.user_id = $user_id
      WHERE pt.picture_id = p.id
      AND COALESCE(us.enabled, 1) = 1
    )
  ${order_by}
  LIMIT $limit
`;

const PICTURE_MARK_SEEN_SQL =
  'INSERT OR IGNORE INTO user_pictures (user_id, picture_id) VALUES ($user_id, $picture_id)';

const PICTURE_SET_LIKE_SQL = `
  INSERT INTO user_pictures (user_id, picture_id, like) VALUES ($user_id, $picture_id, $like)
  ON CONFLICT(user_id, picture_id) DO UPDATE SET like = excluded.like
`;

const PICTURE_GET_VOTED_SQL = `
  SELECT p.id, p.title, p.url, p.image_url, p.caption, p.credit, up.like
  FROM pictures p
  JOIN user_pictures up ON p.id = up.picture_id
  WHERE up.like = $like AND up.user_id = $user_id
  ORDER BY p.id DESC
`;

export const get_next_pictures_internal = (
  limit: number,
  user_id: number | null,
  strength?: number
): Picture[] => {
  const db = get_db();
  const get_next = db.prepare(PICTURE_GET_NEXT_SQL(weighted_random_order_by(strength)));
  const mark_seen = db.prepare(PICTURE_MARK_SEEN_SQL);
  const rows = get_next.all({ $limit: limit, $user_id: user_id }) as unknown as PictureDbRow[];
  if (user_id !== null) {
    db.exec('BEGIN');
    for (const row of rows) {
      mark_seen.run({ $user_id: user_id, $picture_id: row.id });
    }
    db.exec('COMMIT');
  }
  return rows.map(row_to_picture);
};

export const set_picture_like = (id: number, value: -1 | 0 | 1, user_id: number) => {
  get_db().prepare(PICTURE_SET_LIKE_SQL).run({ $user_id: user_id, $picture_id: id, $like: value });
};

export const get_voted_pictures = (vote: -1 | 1, user_id: number | null): Picture[] => {
  const rows = get_db()
    .prepare(PICTURE_GET_VOTED_SQL)
    .all({ $like: vote, $user_id: user_id }) as unknown as PictureDbRow[];
  return rows.map(row_to_picture);
};
