import { type FeedItem } from './types';
import { fetch_articles_by_ids } from './articles';
import { fetch_pictures_by_ids } from './pictures';
import { get_db } from './connection';
import { feed_affinity_ctes, AFFINITY_STRENGTH, AFFINITY_CLAMP } from './affinity';

// Read at module load — use jest.resetModules() before importing to control
// the ratio in tests.
const PICTURE_RATIO =
  process.env.FEED_PICTURE_RATIO !== undefined ? parseFloat(process.env.FEED_PICTURE_RATIO) : 0.1;

const MARK_SEEN_SQL =
  'INSERT OR IGNORE INTO user_items (user_id, item_id) VALUES ($user_id, $item_id)';

// $ratio = 0 -> WHERE excludes pictures; $ratio = 1 -> excludes articles.
// type_share / pool_size normalizes so expected picture share = $ratio regardless
// of pool size imbalance. max(ps.n, 1) guards division by zero.
const FEED_GET_NEXT_SQL = `
  ${feed_affinity_ctes()}
  SELECT p.type, p.id
  FROM eligible_pool p
  JOIN pool_size ps ON ps.type = p.type
  LEFT JOIN item_affinity ia ON ia.item_id = p.id
  WHERE (p.type = 'picture' AND $ratio > 0)
     OR (p.type = 'article' AND $ratio < 1)
  ORDER BY
    -ln(max((RANDOM() / 9223372036854775808.0 + 1.0) / 2.0, 1e-12))
    / ( exp(${AFFINITY_STRENGTH} * max(-${AFFINITY_CLAMP}, min(${AFFINITY_CLAMP}, COALESCE(ia.affinity, 0.0))))
        * (CASE p.type WHEN 'picture' THEN $ratio ELSE 1.0 - $ratio END)
        / max(ps.n, 1) )
  LIMIT $limit
`;

export const get_next_feed = (count: number, user_id: number | null): FeedItem[] => {
  const db = get_db();
  const rows = db.prepare(FEED_GET_NEXT_SQL).all({
    $limit: count,
    $user_id: user_id,
    $ratio: PICTURE_RATIO,
  }) as unknown as { type: 'article' | 'picture'; id: number }[];

  const article_ids = rows.filter((r) => r.type === 'article').map((r) => r.id);
  const picture_ids = rows.filter((r) => r.type === 'picture').map((r) => r.id);

  const articles = new Map(fetch_articles_by_ids(article_ids, user_id).map((x) => [x.id, x]));
  const pictures = new Map(fetch_pictures_by_ids(picture_ids, user_id).map((x) => [x.id, x]));

  if (user_id !== null) {
    const mark_seen = db.prepare(MARK_SEEN_SQL);
    db.exec('BEGIN');
    for (const r of rows) {
      mark_seen.run({ $user_id: user_id, $item_id: r.id });
    }
    db.exec('COMMIT');
  }

  return rows.flatMap((r) => {
    const item = r.type === 'article' ? articles.get(r.id) : pictures.get(r.id);
    return item ? [item] : [];
  });
};
