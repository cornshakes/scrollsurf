import { type CategoryTree, type TopicStat, type CategoryGroup } from './types';
import { get_db } from './connection';

const GET_TOP_LEVELS_SQL = `
  SELECT
    ch.top_level,
    COUNT(DISTINCT i.id) AS article_count,
    COUNT(DISTINCT CASE WHEN ui.like =  1 THEN i.id END) AS liked,
    COUNT(DISTINCT CASE WHEN ui.like = -1 THEN i.id END) AS disliked
  FROM category_hierarchy ch
  JOIN categories c ON c.name = ch.category_name
  JOIN item_categories ic ON ic.category_id = c.id
  JOIN items i ON i.id = ic.item_id AND i.type IN ('article', 'picture')
  LEFT JOIN user_items ui ON i.id = ui.item_id AND ui.user_id = $user_id
  GROUP BY ch.top_level
  ORDER BY ch.top_level
`;

const GET_CATEGORIES_SQL = `
  SELECT
    ch.category_name AS topic,
    ch.top_level,
    COUNT(i.id) AS article_count,
    COUNT(CASE WHEN ui.like =  1 THEN 1 END) AS liked,
    COUNT(CASE WHEN ui.like = -1 THEN 1 END) AS disliked
  FROM category_hierarchy ch
  JOIN categories c ON c.name = ch.category_name
  JOIN item_categories ic ON ic.category_id = c.id
  JOIN items i ON i.id = ic.item_id AND i.type IN ('article', 'picture')
  LEFT JOIN user_items ui ON i.id = ui.item_id AND ui.user_id = $user_id
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
