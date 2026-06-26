import { get_db } from './connection';

// Batch-fetch visible (non-hidden) category names. Returns item_id -> string[].
export const fetch_visible_categories = (ids: number[]): Map<number, string[]> => {
  const by_id = new Map<number, string[]>();
  if (ids.length === 0) {
    return by_id;
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = get_db()
    .prepare(
      `SELECT ic.item_id, c.name
       FROM item_categories ic
       JOIN categories c ON ic.category_id = c.id
       WHERE c.hidden = 0 AND ic.item_id IN (${placeholders})`
    )
    .all(...ids) as unknown as { item_id: number; name: string }[];
  for (const row of rows) {
    const list = by_id.get(row.item_id) ?? [];
    list.push(row.name);
    by_id.set(row.item_id, list);
  }
  return by_id;
};
