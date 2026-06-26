import { type Quote, type Link } from './types';
import { get_db } from './connection';
import { fetch_links_for_items } from './links';

type QuoteDbRow = Omit<Quote, 'type' | 'links'>;

const row_to_quote = (r: QuoteDbRow, links: Link[]): Quote => ({
  type: 'quote',
  id: r.id,
  title: r.title,
  url: r.url,
  like: r.like,
  author: r.author,
  author_url: r.author_url,
  author_image: r.author_image,
  quote_year: r.quote_year,
  links,
});

export const fetch_quotes_by_ids = (ids: number[], user_id: number | null): Quote[] => {
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = get_db()
    .prepare(
      `SELECT i.id, i.title, i.url, q.author, q.author_url, q.author_image, q.quote_year,
              COALESCE(ui.like, 0) AS like
       FROM items i
       JOIN quotes q ON q.item_id = i.id
       LEFT JOIN user_items ui ON ui.item_id = i.id AND ui.user_id = ?
       WHERE i.id IN (${placeholders})`
    )
    .all(user_id, ...ids) as unknown as QuoteDbRow[];
  const links_by_id = fetch_links_for_items(ids);
  const by_id = new Map(rows.map((r) => [r.id, row_to_quote(r, links_by_id.get(r.id) ?? [])]));
  return ids.flatMap((id) => {
    const q = by_id.get(id);
    return q ? [q] : [];
  });
};

export const get_voted_quotes = (vote: -1 | 1, user_id: number | null): Quote[] => {
  const rows = get_db()
    .prepare(
      `SELECT i.id, i.title, i.url, q.author, q.author_url, ui.like
       FROM items i
       JOIN quotes q ON q.item_id = i.id
       JOIN user_items ui ON ui.item_id = i.id
       WHERE ui.like = $like AND ui.user_id = $user_id
       ORDER BY i.id DESC`
    )
    .all({ $like: vote, $user_id: user_id }) as unknown as { id: number }[];
  return fetch_quotes_by_ids(
    rows.map((r) => r.id),
    user_id
  );
};
