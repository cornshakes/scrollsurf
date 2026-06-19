import { type Picture, type Topic } from './types';
import { get_db } from './connection';
import { fetch_topics_for_items } from './topics';

type PictureDbRow = Omit<Picture, 'type' | 'topics'>;

const row_to_picture = (r: PictureDbRow, topics: Topic[]): Picture => ({
  type: 'picture',
  id: r.id,
  title: r.title,
  url: r.url,
  like: r.like,
  image_url: r.image_url,
  caption: r.caption,
  credit: r.credit,
  topics,
});

export const fetch_pictures_by_ids = (ids: number[], user_id: number | null): Picture[] => {
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = get_db()
    .prepare(
      `SELECT i.id, i.title, i.url, p.image_url, p.caption, p.credit,
              COALESCE(ui.like, 0) AS like
       FROM items i
       JOIN pictures p ON p.item_id = i.id
       LEFT JOIN user_items ui ON ui.item_id = i.id AND ui.user_id = ?
       WHERE i.id IN (${placeholders})`
    )
    .all(user_id, ...ids) as unknown as PictureDbRow[];
  const topics_by_id = fetch_topics_for_items(ids);
  const by_id = new Map(rows.map((r) => [r.id, row_to_picture(r, topics_by_id.get(r.id) ?? [])]));
  return ids.flatMap((id) => {
    const p = by_id.get(id);
    return p ? [p] : [];
  });
};

export const get_voted_pictures = (vote: -1 | 1, user_id: number | null): Picture[] => {
  const rows = get_db()
    .prepare(
      `SELECT i.id, i.title, i.url, p.image_url, p.caption, p.credit, ui.like
       FROM items i
       JOIN pictures p ON p.item_id = i.id
       JOIN user_items ui ON ui.item_id = i.id
       WHERE ui.like = $like AND ui.user_id = $user_id
       ORDER BY i.id DESC`
    )
    .all({ $like: vote, $user_id: user_id }) as unknown as { id: number }[];
  return fetch_pictures_by_ids(
    rows.map((r) => r.id),
    user_id
  );
};
