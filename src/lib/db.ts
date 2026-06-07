import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export interface Article {
  id: number;
  title: string;
  extract: string;
  url: string;
  like: -1 | 0 | 1;
  description: string | null;
  image_url: string | null;
  categories: string[];
}

export interface TopicStat {
  topic: string;
  article_count: number;
  liked: number;
  disliked: number;
}

export interface DatasetGroup {
  dataset: string;
  source_url: string | null;
  article_count: number;
  liked: number;
  disliked: number;
  topics: TopicStat[];
}

export interface CategoryGroup {
  top_level: string;
  article_count: number;
  liked: number;
  disliked: number;
  categories: TopicStat[];
}

export type TopicTree = DatasetGroup[];
export type CategoryTree = CategoryGroup[];

export const db = new DatabaseSync(path.join(process.cwd(), 'scrollsurf.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    extract     TEXT    NOT NULL,
    url         TEXT    NOT NULL UNIQUE,
    description TEXT,
    image_url   TEXT
  );

  CREATE TABLE IF NOT EXISTS user_articles (
    article_id INTEGER PRIMARY KEY REFERENCES articles(id),
    like       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS categories (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    name   TEXT    NOT NULL UNIQUE,
    hidden INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS article_categories (
    article_id  INTEGER NOT NULL REFERENCES articles(id),
    category_id INTEGER NOT NULL REFERENCES categories(id),
    PRIMARY KEY (article_id, category_id)
  );

  CREATE TABLE IF NOT EXISTS article_topics (
    article_id INTEGER NOT NULL REFERENCES articles(id),
    dataset    TEXT    NOT NULL,
    topic      TEXT    NOT NULL,
    PRIMARY KEY (article_id, dataset, topic)
  );

  CREATE TABLE IF NOT EXISTS datasets (
    name       TEXT NOT NULL PRIMARY KEY,
    source_url TEXT
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    dataset TEXT NOT NULL PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (dataset) REFERENCES datasets(name)
  );

  CREATE TABLE IF NOT EXISTS category_hierarchy (
    category_name TEXT NOT NULL PRIMARY KEY,
    top_level     TEXT NOT NULL
  );
`);

const VISIBLE_CATEGORIES_SUBQUERY = `
  (SELECT GROUP_CONCAT(c.name, '|||')
   FROM article_categories ac
   JOIN categories c ON ac.category_id = c.id
   WHERE ac.article_id = a.id AND c.hidden = 0)
`;

const get_next_stmt = db.prepare(`
  SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url,
         COALESCE(ua.like, 0) AS like,
         ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories
  FROM articles a
  LEFT JOIN user_articles ua ON a.id = ua.article_id
  WHERE ua.article_id IS NULL
    AND (
      SELECT COALESCE(MAX(us.enabled), 1)
      FROM article_topics at
      LEFT JOIN user_settings us ON us.dataset = at.dataset
      WHERE at.article_id = a.id
      LIMIT 1
    ) = 1
  ORDER BY RANDOM()
  LIMIT $limit
`);

const mark_seen_stmt = db.prepare(
  'INSERT OR IGNORE INTO user_articles (article_id) VALUES ($article_id)'
);

const set_like_stmt = db.prepare(
  'UPDATE user_articles SET like = $like WHERE article_id = $article_id'
);

const get_voted_stmt = db.prepare(`
  SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url, ua.like,
         ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories
  FROM articles a
  JOIN user_articles ua ON a.id = ua.article_id
  WHERE ua.like = $like
  ORDER BY a.id DESC
`);

const get_datasets_stmt = db.prepare(`
  SELECT
    t.dataset,
    d.source_url,
    COUNT(DISTINCT t.article_id) AS article_count,
    COUNT(DISTINCT CASE WHEN ua.like =  1 THEN t.article_id END) AS liked,
    COUNT(DISTINCT CASE WHEN ua.like = -1 THEN t.article_id END) AS disliked
  FROM article_topics t
  LEFT JOIN user_articles ua ON t.article_id = ua.article_id
  LEFT JOIN datasets d ON d.name = t.dataset
  GROUP BY t.dataset
  ORDER BY t.dataset
`);

const get_top_levels_stmt = db.prepare(`
  SELECT
    ch.top_level,
    COUNT(DISTINCT a.id) AS article_count,
    COUNT(DISTINCT CASE WHEN ua.like =  1 THEN a.id END) AS liked,
    COUNT(DISTINCT CASE WHEN ua.like = -1 THEN a.id END) AS disliked
  FROM category_hierarchy ch
  JOIN categories c ON c.name = ch.category_name
  JOIN article_categories ac ON ac.category_id = c.id
  JOIN articles a ON a.id = ac.article_id
  LEFT JOIN user_articles ua ON a.id = ua.article_id
  GROUP BY ch.top_level
  ORDER BY ch.top_level
`);

const get_categories_stmt = db.prepare(`
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
  LEFT JOIN user_articles ua ON a.id = ua.article_id
  GROUP BY ch.category_name
  ORDER BY ch.top_level, ch.category_name
`);

const get_topics_stmt = db.prepare(`
  SELECT
    t.dataset,
    t.topic,
    COUNT(t.article_id) AS article_count,
    COUNT(CASE WHEN ua.like =  1 THEN 1 END) AS liked,
    COUNT(CASE WHEN ua.like = -1 THEN 1 END) AS disliked
  FROM article_topics t
  LEFT JOIN user_articles ua ON t.article_id = ua.article_id
  GROUP BY t.dataset, t.topic
  ORDER BY t.dataset, t.topic
`);

type DbRow = Omit<Article, 'categories'> & { visible_categories: string | null };

const row_to_article = (r: DbRow): Article => ({
  id: r.id,
  title: r.title,
  extract: r.extract,
  url: r.url,
  like: r.like,
  description: r.description,
  image_url: r.image_url,
  categories: r.visible_categories ? r.visible_categories.split('|||') : [],
});

export const get_next_articles = (limit: number): Article[] => {
  const rows = get_next_stmt.all({ $limit: limit }) as unknown as DbRow[];
  db.exec('BEGIN');
  for (const row of rows) {
    mark_seen_stmt.run({ $article_id: row.id });
  }
  db.exec('COMMIT');
  return rows.map(row_to_article);
};

export const set_like = (article_id: number, value: -1 | 0 | 1) => {
  set_like_stmt.run({ $article_id: article_id, $like: value });
};

export const get_voted_articles = (vote: -1 | 1): Article[] => {
  const rows = get_voted_stmt.all({ $like: vote }) as unknown as DbRow[];
  return rows.map(row_to_article);
};

const set_dataset_enabled_stmt = db.prepare(
  'INSERT OR REPLACE INTO user_settings (dataset, enabled) VALUES ($dataset, $enabled)'
);

const get_datasets_enabled_stmt = db.prepare(
  'SELECT d.name AS dataset, COALESCE(us.enabled, 1) AS enabled FROM datasets d LEFT JOIN user_settings us ON us.dataset = d.name ORDER BY d.name'
);

export const set_dataset_enabled = (dataset: string, enabled: boolean) => {
  set_dataset_enabled_stmt.run({ $dataset: dataset, $enabled: enabled ? 1 : 0 });
};

export const get_datasets_enabled = (): Record<string, boolean> => {
  const rows = get_datasets_enabled_stmt.all() as unknown as { dataset: string; enabled: number }[];
  return Object.fromEntries(rows.map((r) => [r.dataset, r.enabled === 1]));
};

export const get_category_tree = (): CategoryTree => {
  const top_level_rows = get_top_levels_stmt.all() as unknown as CategoryGroup[];
  const category_rows = get_categories_stmt.all() as unknown as (TopicStat & {
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

export const get_topic_tree = (): TopicTree => {
  const dataset_rows = get_datasets_stmt.all() as unknown as DatasetGroup[];
  const topic_rows = get_topics_stmt.all() as unknown as (TopicStat & { dataset: string })[];
  return dataset_rows.map((d) => ({
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
};
