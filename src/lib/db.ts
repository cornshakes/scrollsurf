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

export type TopicTree = TopicStat[];

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
    topic      TEXT    NOT NULL,
    PRIMARY KEY (article_id, topic)
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

const get_topics_stmt = db.prepare(`
  SELECT
    t.topic,
    COUNT(t.article_id) AS article_count,
    COUNT(CASE WHEN ua.like =  1 THEN 1 END) AS liked,
    COUNT(CASE WHEN ua.like = -1 THEN 1 END) AS disliked
  FROM article_topics t
  LEFT JOIN user_articles ua ON t.article_id = ua.article_id
  GROUP BY t.topic
  ORDER BY t.topic
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

export const get_topic_tree = (): TopicTree => {
  const rows = get_topics_stmt.all() as unknown as TopicStat[];
  return rows.map((r) => ({
    topic: r.topic,
    article_count: r.article_count,
    liked: r.liked,
    disliked: r.disliked,
  }));
};
