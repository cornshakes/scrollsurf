import { type FeedItem } from './types';
import { fetch_articles_by_ids } from './articles';
import { fetch_pictures_by_ids } from './pictures';
import { fetch_quotes_by_ids } from './quotes';
import { get_db } from './connection';
import { feed_affinity_ctes, AFFINITY_STRENGTH, AFFINITY_CLAMP } from './affinity';
import { groupBy, keyBy } from 'es-toolkit';

// Per-type feed shares. Relative weights — each type's expected fraction of the
// feed is its share ÷ Σshares, independent of pool sizes. A share of 0 (or a type
// absent from this map) hard-excludes that type via the `type_where` clause below.
export const TYPE_SHARES = {
  article: 0.85,
  picture: 0.1,
  quote: 0.05,
};

const included_types = Object.keys(TYPE_SHARES);

// WHERE clause: only types with a positive share are eligible
const type_where =
  included_types.length > 0
    ? `p.type IN (${included_types.map((t) => `'${t}'`).join(', ')})`
    : 'FALSE';

// CASE expression: unnormalized per-type share weight.
// Pool-size normalization (/ max(ps.n, 1)) ensures expected fraction = share / Σshares
// for types actually present in the pool.
const type_weight_expr =
  `CASE p.type ` +
  [...Object.entries(TYPE_SHARES)]
    .filter(([, share]) => share > 0)
    .map(([type_name, share]) => `WHEN '${type_name}' THEN ${share}`)
    .join(' ') +
  ` ELSE 0 END`;

const MARK_SEEN_SQL =
  'INSERT OR IGNORE INTO user_items (user_id, item_id) VALUES ($user_id, $item_id)';

const FEED_GET_NEXT_SQL = `
  ${feed_affinity_ctes()}
  SELECT p.type, p.id
  FROM eligible_pool p
  JOIN pool_size ps ON ps.type = p.type
  LEFT JOIN item_affinity ia ON ia.item_id = p.id
  WHERE ${type_where}
  ORDER BY
    -ln(max((RANDOM() / 9223372036854775808.0 + 1.0) / 2.0, 1e-12))
    / ( exp(${AFFINITY_STRENGTH} * max(-${AFFINITY_CLAMP}, min(${AFFINITY_CLAMP}, COALESCE(ia.affinity, 0.0))))
        * ${type_weight_expr}
        / max(ps.n, 1) )
  LIMIT $limit
`;

export const get_next_feed = (count: number, user_id: number | null): FeedItem[] => {
  const db = get_db();
  const rows = db.prepare(FEED_GET_NEXT_SQL).all({
    $limit: count,
    $user_id: user_id,
  }) as unknown as { type: 'article' | 'picture' | 'quote'; id: number }[];

  if (user_id !== null) {
    const mark_seen = db.prepare(MARK_SEEN_SQL);
    db.exec('BEGIN');
    for (const r of rows) {
      mark_seen.run({ $user_id: user_id, $item_id: r.id });
    }
    db.exec('COMMIT');
  }
  return hydrate_feed_items(rows, user_id);
};

export const hydrate_feed_items = (
  rows: { type: 'article' | 'picture' | 'quote'; id: number }[],
  user_id: number | null
) => {
  const rows_by_type = groupBy(rows, (r) => r.type);
  const feed_items = Object.entries(rows_by_type).flatMap<FeedItem>(([type, row]) => {
    const ids = row.map((r) => r.id);
    switch (type) {
      case 'article':
        return fetch_articles_by_ids(ids, user_id);
      case 'picture':
        return fetch_pictures_by_ids(ids, user_id);
      case 'quote':
        return fetch_quotes_by_ids(ids, user_id);
      default:
        throw new Error();
    }
  });
  const feed_items_by_id = keyBy(feed_items, (i) => i.id);

  return rows.map((row) => feed_items_by_id[row.id]);
};
