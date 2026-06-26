import { type Link } from './types';
import { get_db } from './connection';
import { fetch_visible_categories } from './categories';

export const fetch_links_for_items = (ids: number[]): Map<number, Link[]> => {
  const by_id = new Map<number, Link[]>();
  if (ids.length === 0) {
    return by_id;
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = get_db()
    .prepare(
      `SELECT it.item_id, it.dataset, it.topic, d.source_url
       FROM item_topics it
       LEFT JOIN datasets d ON d.name = it.dataset
       WHERE it.item_id IN (${placeholders})`
    )
    .all(...ids) as unknown as {
    item_id: number;
    dataset: string;
    topic: string;
    source_url: string | null;
  }[];

  // item_topics has PRIMARY KEY (item_id, dataset, topic), so each row is
  // already unique per item — no dedup needed.
  for (const row of rows) {
    const list = by_id.get(row.item_id) ?? [];
    list.push({ type: 'dataset', title: row.dataset, url: row.source_url });
    list.push({
      type: 'topic',
      title: row.topic,
      url: row.source_url ? `${row.source_url}/${row.topic.replace(/ /g, '_')}` : null,
    });
    by_id.set(row.item_id, list);
  }

  const categories = fetch_visible_categories(ids);
  for (const [item_id, names] of categories) {
    const list = by_id.get(item_id) ?? [];
    for (const name of names) {
      list.push({
        type: 'category',
        title: name,
        url: `https://en.wikipedia.org/wiki/Category:${encodeURIComponent(name)}`,
      });
    }
    by_id.set(item_id, list);
  }

  return by_id;
};
