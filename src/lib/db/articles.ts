import { type Article, type Link } from './types';
import { get_db } from './connection';
import { fetch_links_for_items } from './links';

type ArticleDbRow = Omit<Article, 'type' | 'links'>;

export const row_to_article = (r: ArticleDbRow, links: Link[]): Article => ({
  type: 'article',
  id: r.id,
  title: r.title,
  extract: r.extract,
  url: r.url,
  like: r.like,
  description: r.description,
  image_url: r.image_url,
  links,
});

export const fetch_articles_by_ids = (ids: number[], user_id: number | null): Article[] => {
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = get_db()
    .prepare(
      `SELECT i.id, i.title, i.url, a.extract, a.description, a.image_url,
              COALESCE(ui.like, 0) AS like
       FROM items i
       JOIN articles a ON a.item_id = i.id
       LEFT JOIN user_items ui ON ui.item_id = i.id AND ui.user_id = ?
       WHERE i.id IN (${placeholders})`
    )
    .all(user_id, ...ids) as unknown as ArticleDbRow[];
  const links_by_id = fetch_links_for_items(ids);
  const by_id = new Map(rows.map((r) => [r.id, row_to_article(r, links_by_id.get(r.id) ?? [])]));
  return ids.flatMap((id) => {
    const a = by_id.get(id);
    return a ? [a] : [];
  });
};

export const get_voted_articles = (vote: -1 | 1, user_id: number | null): Article[] => {
  const rows = get_db()
    .prepare(
      `SELECT i.id, i.title, i.url, a.extract, a.description, a.image_url, ui.like
       FROM items i
       JOIN articles a ON a.item_id = i.id
       JOIN user_items ui ON ui.item_id = i.id
       WHERE ui.like = $like AND ui.user_id = $user_id
       ORDER BY i.id DESC`
    )
    .all({ $like: vote, $user_id: user_id }) as unknown as { id: number }[];
  return fetch_articles_by_ids(
    rows.map((r) => r.id),
    user_id
  );
};
