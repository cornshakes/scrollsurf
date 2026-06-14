export const W_LIKE = 1.0;
export const W_CLICK = 0.5;
export const W_DISLIKE = 1.0;
export const AFFINITY_SMOOTHING = 5.0;
export const AFFINITY_CLAMP = 2.0;

const _parsed_strength = parseFloat(process.env.FEED_AFFINITY_STRENGTH ?? '');
export const AFFINITY_STRENGTH = isNaN(_parsed_strength) ? 2.0 : _parsed_strength;

type AffinityTables =
  | {
      topics_table: 'article_topics';
      user_table: 'user_articles';
      item_id_col: 'article_id';
      item_type: 'article';
    }
  | {
      topics_table: 'picture_topics';
      user_table: 'user_pictures';
      item_id_col: 'picture_id';
      item_type: 'picture';
    };

// WITH-clause producing `item_affinity (item_id, affinity)`. Caller LEFT JOINs
// it as `ia` and uses weighted_random_order_by(). NULL $user_id -> empty CTEs
// -> affinity 0 everywhere -> uniform.
export const affinity_ctes = (t: AffinityTables): string => `
  WITH clicked AS (
    SELECT DISTINCT item_id
    FROM user_clicks
    WHERE user_id = $user_id AND item_type = '${t.item_type}'
  ),
  topic_affinity AS MATERIALIZED (
    SELECT ut.dataset, ut.topic,
           (${W_LIKE} * COUNT(CASE WHEN u.like =  1 THEN 1 END)
          + ${W_CLICK} * COUNT(CASE WHEN c.item_id IS NOT NULL THEN 1 END)
          - ${W_DISLIKE} * COUNT(CASE WHEN u.like = -1 THEN 1 END))
           / (COUNT(*) + ${AFFINITY_SMOOTHING}) AS affinity
    FROM ${t.user_table} u
    JOIN ${t.topics_table} ut ON ut.${t.item_id_col} = u.${t.item_id_col}
    LEFT JOIN clicked c ON c.item_id = u.${t.item_id_col}
    WHERE u.user_id = $user_id
    GROUP BY ut.dataset, ut.topic
  ),
  item_affinity AS MATERIALIZED (
    SELECT ut.${t.item_id_col} AS item_id, AVG(COALESCE(ta.affinity, 0.0)) AS affinity
    FROM ${t.topics_table} ut
    LEFT JOIN topic_affinity ta ON ta.dataset = ut.dataset AND ta.topic = ut.topic
    GROUP BY ut.${t.item_id_col}
  )
`;

// RANDOM() is int64; map to (0, 1] and guard ln(0) -> NULL (NULLs sort first ASC
// and would win every draw — the max(..., 1e-12) guard is load-bearing).
export const weighted_random_order_by = (strength = AFFINITY_STRENGTH): string => `
  ORDER BY -ln(max((RANDOM() / 9223372036854775808.0 + 1.0) / 2.0, 1e-12))
           / exp(${strength} * max(-${AFFINITY_CLAMP}, min(${AFFINITY_CLAMP}, COALESCE(ia.affinity, 0.0))))
`;

// Shared formula: likes/clicks/dislikes over exposure. Assumes aliases u (user
// table), ut (topics table), c (clicked CTE) are in scope.
const topic_affinity_score = (): string =>
  `(${W_LIKE}    * COUNT(CASE WHEN u.like =  1 THEN 1 END)
  + ${W_CLICK}   * COUNT(CASE WHEN c.item_id IS NOT NULL THEN 1 END)
  - ${W_DISLIKE} * COUNT(CASE WHEN u.like = -1 THEN 1 END))
  / (COUNT(*) + ${AFFINITY_SMOOTHING})`;

// WITH-clause producing:
//   item_affinity (item_type, item_id, affinity) — both article + picture arms
//   eligible_pool (type, id) — unseen + has-topic rows from feed_items
//   pool_size (type, n) — COUNT(*) per type from eligible_pool
// NULL $user_id -> empty signal CTEs -> affinity 0 everywhere -> per-type uniform.
export const feed_affinity_ctes = (): string => `
  WITH
  article_clicked AS (
    SELECT DISTINCT item_id
    FROM user_clicks
    WHERE user_id = $user_id AND item_type = 'article'
  ),
  article_topic_affinity AS MATERIALIZED (
    SELECT ut.dataset, ut.topic, ${topic_affinity_score()} AS affinity
    FROM user_articles u
    JOIN article_topics ut ON ut.article_id = u.article_id
    LEFT JOIN article_clicked c ON c.item_id = u.article_id
    WHERE u.user_id = $user_id
    GROUP BY ut.dataset, ut.topic
  ),
  article_item_affinity AS MATERIALIZED (
    SELECT ut.article_id AS item_id, 'article' AS item_type,
           AVG(COALESCE(ta.affinity, 0.0)) AS affinity
    FROM article_topics ut
    LEFT JOIN article_topic_affinity ta ON ta.dataset = ut.dataset AND ta.topic = ut.topic
    GROUP BY ut.article_id
  ),
  picture_clicked AS (
    SELECT DISTINCT item_id
    FROM user_clicks
    WHERE user_id = $user_id AND item_type = 'picture'
  ),
  picture_topic_affinity AS MATERIALIZED (
    SELECT ut.dataset, ut.topic, ${topic_affinity_score()} AS affinity
    FROM user_pictures u
    JOIN picture_topics ut ON ut.picture_id = u.picture_id
    LEFT JOIN picture_clicked c ON c.item_id = u.picture_id
    WHERE u.user_id = $user_id
    GROUP BY ut.dataset, ut.topic
  ),
  picture_item_affinity AS MATERIALIZED (
    SELECT ut.picture_id AS item_id, 'picture' AS item_type,
           AVG(COALESCE(ta.affinity, 0.0)) AS affinity
    FROM picture_topics ut
    LEFT JOIN picture_topic_affinity ta ON ta.dataset = ut.dataset AND ta.topic = ut.topic
    GROUP BY ut.picture_id
  ),
  item_affinity AS (
    SELECT item_type, item_id, affinity FROM article_item_affinity
    UNION ALL
    SELECT item_type, item_id, affinity FROM picture_item_affinity
  ),
  eligible_pool AS MATERIALIZED (
    SELECT fi.type, fi.id
    FROM feed_items fi
    WHERE (
      fi.type = 'article'
      AND NOT EXISTS (
        SELECT 1 FROM user_articles ua
        WHERE ua.article_id = fi.id AND ua.user_id = $user_id
      )
      AND EXISTS (
        SELECT 1 FROM article_topics ato WHERE ato.article_id = fi.id
      )
    ) OR (
      fi.type = 'picture'
      AND NOT EXISTS (
        SELECT 1 FROM user_pictures up
        WHERE up.picture_id = fi.id AND up.user_id = $user_id
      )
      AND EXISTS (
        SELECT 1 FROM picture_topics pt WHERE pt.picture_id = fi.id
      )
    )
  ),
  pool_size AS (
    SELECT type, COUNT(*) AS n FROM eligible_pool GROUP BY type
  )
`;
