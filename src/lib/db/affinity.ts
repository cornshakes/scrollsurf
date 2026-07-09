import { get_db } from './connection';
import { type FeedItemType } from './types';
import { clamp } from 'es-toolkit';

/**
 * Strength of influence of likes on affinity
 */
const W_LIKE = 1.0;
/**
 * Strength of influence of clicks on affinity
 */
const W_CLICK = 0.5;
/**
 * Strength of influence of dislikes on affinity
 */
const W_DISLIKE = 1.0;
/**
 * Offset used to make sure a few likes don't influnce much yet
 */
const AFFINITY_SMOOTHING = 5.0;
/**
 * Clamping of final affinity to make sure one group doesn't get too big
 */
const AFFINITY_CLAMP = 2.0;

/**
 * Per-type strength of the affinity boost
 * e.g. liking articles will boost the affinity to its topic bucket set by 2.0
 * vs liking a quote (0.0) won't change anything
 * (because quotes don't have proper topics and this would only lead to more quotes instead of more feed items with a similar topic)
 */
const AFFINITY_STRENGTH: Record<string, number> = {
  article: 2.0,
  picture: 2.0,
  quote: 0.0,
};

/**
 * Relation of different item types in each feed draw e.g. picture 0.1 means ~10% of items will be pictures.
 * The sum of all shares has to be 1.
 */
export const TYPE_SHARES: Record<FeedItemType, number> = {
  article: 0.82,
  picture: 0.1,
  quote: 0.08,
};

export type BucketSet = {
  set_id: number;
  type: FeedItemType;
  item_count: number;
  weight: number;
};

/**
 *
 * Loads all bucket sets that have available items with weights adjusted for the user.
 * If the user id is null, the weights are not influenced by any activity.
 *
 */
export const load_weighted_bucket_sets = (user_id: number | null): BucketSet[] => {
  const sets = get_db().prepare(load_affinities).all({ $user_id: user_id }) as unknown as {
    set_id: number;
    type: FeedItemType;
    item_count: number;
    affinity: number;
  }[];

  const pool_sizes: Record<string, number> = {};
  for (const set of sets) {
    pool_sizes[set.type] = (pool_sizes[set.type] ?? 0) + set.item_count;
  }

  return sets
    .filter((s) => s.item_count > 0)
    .map(({ type, set_id, item_count, affinity }) => {
      const clamped_affinity = clamp(affinity, -AFFINITY_CLAMP, AFFINITY_CLAMP);
      const type_adjusted_affinity = Math.exp(clamped_affinity * AFFINITY_STRENGTH[type]);
      const type_boost = TYPE_SHARES[type] / pool_sizes[type];
      return {
        type,
        set_id,
        item_count,
        weight: type_adjusted_affinity * type_boost,
      };
    });
};

// Shape of each stage, by example:
//
// clicked — items this user has clicked
//   | item_id |
//   | 42      |
//
// topic_affinity — exposure-normalized signal per bucket
//   | bucket          | affinity |
//   | Vital ∥ History | 0.25     |
//   | Unusual ∥ Places| -0.14    |
//
// set_affinity — average of a bucket set's bucket affinities
//   | set_id | affinity |
//   | 7      | 0.055    |
//
// seen_counts — how many items of each (type, set) the user has seen
//   | type    | set_id | n_seen |
//   | article | 7      | 3      |
//
// final SELECT — one row per (type, bucket set) group => type AffinityRow
//   | type    | set_id | item_count | affinity |
//   | article | 7      | 120        | 0.055    |
//   | picture | 12     | 48         | 0.0      |
const load_affinities = `
  WITH
  clicked AS (
    SELECT DISTINCT item_id
    FROM user_clicks
    WHERE user_id = $user_id
  ),
  topic_affinity AS MATERIALIZED (
    SELECT m.bucket,
        (${W_LIKE}    * COUNT(CASE WHEN u.like =  1 THEN 1 END)
       + ${W_CLICK}   * COUNT(CASE WHEN c.item_id IS NOT NULL THEN 1 END)
       - ${W_DISLIKE} * COUNT(CASE WHEN u.like = -1 THEN 1 END)
       ) / (COUNT(*) + ${AFFINITY_SMOOTHING})
    AS affinity
    FROM user_items u
    JOIN bucket_set_items ibs ON ibs.item_id = u.item_id
    JOIN bucket_set_buckets m ON m.set_id = ibs.set_id
    LEFT JOIN clicked c ON c.item_id = u.item_id
    WHERE u.user_id = $user_id
    GROUP BY m.bucket
  ),
  set_affinity AS MATERIALIZED (
    SELECT m.set_id, SUM(COALESCE(ta.affinity, 0.0)) / COUNT(*) AS affinity
    FROM bucket_set_buckets m
    LEFT JOIN topic_affinity ta ON ta.bucket = m.bucket
    GROUP BY m.set_id
  ),
  seen_counts AS (
    SELECT ibs.type, ibs.set_id, COUNT(*) AS n_seen
    FROM user_items u
    JOIN bucket_set_items ibs ON ibs.item_id = u.item_id
    WHERE u.user_id = $user_id
    GROUP BY ibs.type, ibs.set_id
  )
  SELECT c.type, c.set_id,
         c.item_count - COALESCE(sc.n_seen, 0) AS item_count,
         COALESCE(sa.affinity, 0.0)   AS affinity
  FROM bucket_set_counts c
  LEFT JOIN seen_counts sc ON sc.type = c.type AND sc.set_id = c.set_id
  LEFT JOIN set_affinity sa ON sa.set_id = c.set_id
`;
