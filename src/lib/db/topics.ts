import {
  type TopicTree,
  type CategoryTree,
  type DatasetGroup,
  type TopicStat,
  type CategoryGroup,
} from './types';
import { get_db } from './connection';

const GET_DATASETS_SQL = `
  SELECT
    d.name AS dataset,
    d.source_url,
    COUNT(DISTINCT t.article_id) AS article_count,
    COUNT(DISTINCT CASE WHEN ua.like =  1 THEN t.article_id END) AS liked,
    COUNT(DISTINCT CASE WHEN ua.like = -1 THEN t.article_id END) AS disliked
  FROM datasets d
  LEFT JOIN article_topics t ON t.dataset = d.name
  LEFT JOIN user_articles ua ON t.article_id = ua.article_id AND ua.user_id = $user_id
  WHERE d.name NOT IN (SELECT DISTINCT dataset FROM picture_topics)
  GROUP BY d.name
  ORDER BY d.name
`;

const GET_PICTURE_DATASET_SQL = `
  SELECT
    d.name AS dataset,
    d.source_url,
    COUNT(DISTINCT pt.picture_id) AS article_count,
    COUNT(DISTINCT CASE WHEN up.like =  1 THEN pt.picture_id END) AS liked,
    COUNT(DISTINCT CASE WHEN up.like = -1 THEN pt.picture_id END) AS disliked
  FROM datasets d
  LEFT JOIN picture_topics pt ON pt.dataset = d.name
  LEFT JOIN user_pictures up ON pt.picture_id = up.picture_id AND up.user_id = $user_id
  WHERE d.name = $dataset
  GROUP BY d.name
`;

const GET_PICTURE_TOPICS_SQL = `
  SELECT
    pt.dataset,
    pt.topic,
    COUNT(pt.picture_id) AS article_count,
    COUNT(CASE WHEN up.like =  1 THEN 1 END) AS liked,
    COUNT(CASE WHEN up.like = -1 THEN 1 END) AS disliked
  FROM picture_topics pt
  LEFT JOIN user_pictures up ON pt.picture_id = up.picture_id AND up.user_id = $user_id
  GROUP BY pt.dataset, pt.topic
  ORDER BY pt.dataset, pt.topic
`;

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

const GET_TOPICS_SQL = `
  SELECT
    t.dataset,
    t.topic,
    COUNT(t.article_id) AS article_count,
    COUNT(CASE WHEN ua.like =  1 THEN 1 END) AS liked,
    COUNT(CASE WHEN ua.like = -1 THEN 1 END) AS disliked
  FROM article_topics t
  LEFT JOIN user_articles ua ON t.article_id = ua.article_id AND ua.user_id = $user_id
  GROUP BY t.dataset, t.topic
  ORDER BY t.dataset, t.topic
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

export const get_topic_tree = (user_id: number | null): TopicTree => {
  const db = get_db();
  const article_dataset_rows = db.prepare(GET_DATASETS_SQL).all({
    $user_id: user_id,
  }) as unknown as DatasetGroup[];
  const topic_rows = db
    .prepare(GET_TOPICS_SQL)
    .all({ $user_id: user_id }) as unknown as (TopicStat & {
    dataset: string;
  })[];

  const pic_topic_rows = db.prepare(GET_PICTURE_TOPICS_SQL).all({
    $user_id: user_id,
  }) as unknown as (TopicStat & {
    dataset: string;
  })[];
  const pic_datasets = [...new Set(pic_topic_rows.map((r) => r.dataset))];

  const article_groups: TopicTree = article_dataset_rows.map((d) => ({
    dataset: d.dataset,
    source_url: d.source_url,
    article_count: d.article_count,
    liked: d.liked,
    disliked: d.disliked,
    topics: topic_rows
      .filter((t) => t.dataset === d.dataset)
      .map((t) => ({
        topic: t.topic,
        article_count: t.article_count,
        liked: t.liked,
        disliked: t.disliked,
      })),
  }));

  const get_picture_dataset = db.prepare(GET_PICTURE_DATASET_SQL);
  for (const name of pic_datasets) {
    const row = get_picture_dataset.get({ $user_id: user_id, $dataset: name }) as
      | DatasetGroup
      | undefined;
    if (row) {
      article_groups.push({
        dataset: row.dataset,
        source_url: row.source_url,
        article_count: row.article_count,
        liked: row.liked,
        disliked: row.disliked,
        topics: pic_topic_rows
          .filter((t) => t.dataset === name)
          .map((t) => ({
            topic: t.topic,
            article_count: t.article_count,
            liked: t.liked,
            disliked: t.disliked,
          })),
      });
    }
  }

  return article_groups;
};
