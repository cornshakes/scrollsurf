export const W_LIKE = 1.0;
export const W_CLICK = 0.5;
export const W_DISLIKE = 1.0;
export const AFFINITY_SMOOTHING = 5.0;
export const AFFINITY_CLAMP = 2.0;

const _parsed_strength = parseFloat(process.env.FEED_AFFINITY_STRENGTH ?? '');
export const AFFINITY_STRENGTH = isNaN(_parsed_strength) ? 2.0 : _parsed_strength;

// WITH-clause producing:
//   item_affinity (item_id, affinity) — single arm, type-agnostic
//   eligible_pool (type, id) — unseen + has-topic items from `items`
//   pool_size (type, n) — COUNT(*) per type from eligible_pool
// NULL $user_id -> empty signal CTEs -> affinity 0 everywhere -> per-type uniform.
export const feed_affinity_ctes = (): string => `
  WITH
  clicked AS (
    SELECT DISTINCT item_id
    FROM user_clicks
    WHERE user_id = $user_id
  ),
  topic_affinity AS MATERIALIZED (
    SELECT it.dataset, it.topic, 
        (${W_LIKE}    * COUNT(CASE WHEN u.like =  1 THEN 1 END)
       + ${W_CLICK}   * COUNT(CASE WHEN c.item_id IS NOT NULL THEN 1 END)
       - ${W_DISLIKE} * COUNT(CASE WHEN u.like = -1 THEN 1 END)
       ) / (COUNT(*) + ${AFFINITY_SMOOTHING})
    AS affinity
    FROM user_items u
    JOIN item_topics it ON it.item_id = u.item_id
    LEFT JOIN clicked c ON c.item_id = u.item_id
    WHERE u.user_id = $user_id
    GROUP BY it.dataset, it.topic
  ),
  item_affinity AS MATERIALIZED (
    SELECT it.item_id, AVG(COALESCE(ta.affinity, 0.0)) AS affinity
    FROM item_topics it
    LEFT JOIN topic_affinity ta ON ta.dataset = it.dataset AND ta.topic = it.topic
    GROUP BY it.item_id
  ),
  eligible_pool AS MATERIALIZED (
    SELECT i.type, i.id
    FROM items i
    WHERE NOT EXISTS (
      SELECT 1 FROM user_items ui
      WHERE ui.item_id = i.id AND ui.user_id = $user_id
    )
    AND EXISTS (
      SELECT 1 FROM item_topics it WHERE it.item_id = i.id
    )
  ),
  pool_size AS (
    SELECT type, COUNT(*) AS n FROM eligible_pool GROUP BY type
  )
`;
