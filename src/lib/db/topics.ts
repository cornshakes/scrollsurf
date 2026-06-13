import { type CategoryTree, type TopicStat, type CategoryGroup, type Topic } from './types';
import { get_db } from './connection';

// SQL subquery that aggregates an item's dataset/topic rows into a single
// '|||'-delimited string of 'dataset::topic::source_url' triples. Shared by the
// article and picture queries (each has its own topics table + id column).
export const topics_subquery = (topics_table: string, item_id_col: string, item_alias: string) => `
  (SELECT GROUP_CONCAT(t.dataset || '::' || t.topic || '::' || COALESCE(d.source_url, ''), '|||')
   FROM ${topics_table} t
   LEFT JOIN datasets d ON d.name = t.dataset
   WHERE t.${item_id_col} = ${item_alias}.id)
`;

// Inverse of topics_subquery: parse the aggregated string back into Topic[].
export const parse_topics_str = (str: string | null): Topic[] =>
  str
    ? str.split('|||').map((t) => {
        const parts = t.split('::');
        const dataset_url = parts.length >= 3 ? parts[parts.length - 1] || null : null;
        const dataset = parts[0];
        const topic = parts.slice(1, parts.length - 1).join('::');
        return { dataset, topic, dataset_url };
      })
    : [];

const GET_TOP_LEVELS_SQL = `
  SELECT
    ch.top_level,
    COUNT(DISTINCT a.id) AS article_count,
    COUNT(DISTINCT CASE WHEN ua.like =  1 THEN a.id END) AS liked,
    COUNT(DISTINCT CASE WHEN ua.like = -1 THEN a.id END) AS disliked
  FROM category_hierarchy ch
  JOIN categories c ON c.name = ch.category_name
  JOIN article_categories ac ON ac.category_id = c.id
  JOIN articles a ON a.id = ac.article_id
  LEFT JOIN user_articles ua ON a.id = ua.article_id AND ua.user_id = $user_id
  GROUP BY ch.top_level
  ORDER BY ch.top_level
`;

const GET_CATEGORIES_SQL = `
  SELECT
    ch.category_name AS topic,
    ch.top_level,
    COUNT(a.id) AS article_count,
    COUNT(CASE WHEN ua.like =  1 THEN 1 END) AS liked,
    COUNT(CASE WHEN ua.like = -1 THEN 1 END) AS disliked
  FROM category_hierarchy ch
  JOIN categories c ON c.name = ch.category_name
  JOIN article_categories ac ON ac.category_id = c.id
  JOIN articles a ON a.id = ac.article_id
  LEFT JOIN user_articles ua ON a.id = ua.article_id AND ua.user_id = $user_id
  GROUP BY ch.category_name
  ORDER BY ch.top_level, ch.category_name
`;

export const get_category_tree = (user_id: number | null): CategoryTree => {
  const db = get_db();
  const top_level_rows = db.prepare(GET_TOP_LEVELS_SQL).all({
    $user_id: user_id,
  }) as unknown as CategoryGroup[];
  const category_rows = db
    .prepare(GET_CATEGORIES_SQL)
    .all({ $user_id: user_id }) as unknown as (TopicStat & {
    top_level: string;
  })[];
  return top_level_rows.map((tl) => ({
    top_level: tl.top_level,
    article_count: tl.article_count,
    liked: tl.liked,
    disliked: tl.disliked,
    categories: category_rows
      .filter((c) => c.top_level === tl.top_level)
      .map((c) => ({
        topic: c.topic,
        article_count: c.article_count,
        liked: c.liked,
        disliked: c.disliked,
      })),
  }));
};
