import { type StatementSync } from 'node:sqlite';
import { type Picture } from './types';
import { get_db } from './connection';

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

let stmts: {
  get_next: StatementSync;
  mark_seen: StatementSync;
  set_like: StatementSync;
  get_voted: StatementSync;
} | null = null;

const s = () => {
  if (stmts) {
    return stmts;
  }
  const db = get_db();
  stmts = {
    get_next: db.prepare(`
      SELECT p.id, p.title, p.url, p.image_url, p.caption, p.credit,
             COALESCE(up.like, 0) AS like
      FROM pictures p
      LEFT JOIN user_pictures up ON p.id = up.picture_id AND up.user_id = $user_id
      WHERE up.picture_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM picture_topics pt
          LEFT JOIN user_settings us ON us.dataset = pt.dataset AND us.user_id = $user_id
          WHERE pt.picture_id = p.id
          AND COALESCE(us.enabled, 1) = 1
        )
      ORDER BY RANDOM()
      LIMIT $limit
    `),
    mark_seen: db.prepare(
      'INSERT OR IGNORE INTO user_pictures (user_id, picture_id) VALUES ($user_id, $picture_id)'
    ),
    set_like: db.prepare(
      `INSERT INTO user_pictures (user_id, picture_id, like) VALUES ($user_id, $picture_id, $like)
       ON CONFLICT(user_id, picture_id) DO UPDATE SET like = excluded.like`
    ),
    get_voted: db.prepare(`
      SELECT p.id, p.title, p.url, p.image_url, p.caption, p.credit, up.like
      FROM pictures p
      JOIN user_pictures up ON p.id = up.picture_id
      WHERE up.like = $like AND up.user_id = $user_id
      ORDER BY p.id DESC
    `),
  };
  return stmts;
};

export const get_next_pictures_internal = (limit: number, user_id: number | null): Picture[] => {
  const db = get_db();
  const rows = s().get_next.all({ $limit: limit, $user_id: user_id }) as unknown as PictureDbRow[];
  if (user_id !== null) {
    db.exec('BEGIN');
    for (const row of rows) {
      s().mark_seen.run({ $user_id: user_id, $picture_id: row.id });
    }
    db.exec('COMMIT');
  }
  return rows.map(row_to_picture);
};

export const set_picture_like = (id: number, value: -1 | 0 | 1, user_id: number) => {
  s().set_like.run({ $user_id: user_id, $picture_id: id, $like: value });
};

export const get_voted_pictures = (vote: -1 | 1, user_id: number | null): Picture[] => {
  const rows = s().get_voted.all({ $like: vote, $user_id: user_id }) as unknown as PictureDbRow[];
  return rows.map(row_to_picture);
};
