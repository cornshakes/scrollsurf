import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export interface Article {
  id: number;
  title: string;
  extract: string;
  url: string;
  like: -1 | 0 | 1;
}

const db = new DatabaseSync(path.join(process.cwd(), 'scrollsurf.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    title   TEXT    NOT NULL,
    extract TEXT    NOT NULL,
    url     TEXT    NOT NULL UNIQUE
  );
  CREATE INDEX IF NOT EXISTS idx_articles_url ON articles (url);

  CREATE TABLE IF NOT EXISTS user_articles (
    article_id INTEGER PRIMARY KEY REFERENCES articles(id),
    like     INTEGER NOT NULL DEFAULT 0
  );
`);

const insert_stmt = db.prepare(
  'INSERT OR IGNORE INTO articles (title, extract, url) VALUES ($title, $extract, $url)'
);

const get_next_stmt = db.prepare(`
  SELECT a.id, a.title, a.extract, a.url, COALESCE(ua.like, 0) AS like
  FROM articles a
  LEFT JOIN user_articles ua ON a.id = ua.article_id
  WHERE ua.article_id IS NULL
  LIMIT $limit
`);

const mark_seen_stmt = db.prepare(
  'INSERT OR IGNORE INTO user_articles (article_id) VALUES ($article_id)'
);

const count_unseen_stmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM articles a
  LEFT JOIN user_articles ua ON a.id = ua.article_id
  WHERE ua.article_id IS NULL
`);

const set_like_stmt = db.prepare(
  'UPDATE user_articles SET like = $like WHERE article_id = $article_id'
);

const get_voted_stmt = db.prepare(`
  SELECT a.id, a.title, a.extract, a.url, ua.like
  FROM articles a
  JOIN user_articles ua ON a.id = ua.article_id
  WHERE ua.like = $like
  ORDER BY a.id DESC
`);

export function insert_articles(articles: Omit<Article, 'id' | 'like'>[]) {
  db.exec('BEGIN');
  for (const a of articles) {
    insert_stmt.run({ $title: a.title, $extract: a.extract, $url: a.url });
  }
  db.exec('COMMIT');
}

export function get_next_articles(limit: number): Article[] {
  const rows = get_next_stmt.all({ $limit: limit }) as unknown as Article[];
  db.exec('BEGIN');
  for (const row of rows) {
    mark_seen_stmt.run({ $article_id: row.id });
  }
  db.exec('COMMIT');
  return rows.map(({ id, title, extract, url, like }) => ({ id, title, extract, url, like }));
}

export function count_unseen(): number {
  return (count_unseen_stmt.get() as { count: number }).count;
}

export function set_like(article_id: number, value: -1 | 0 | 1) {
  set_like_stmt.run({ $article_id: article_id, $like: value });
}

export function get_voted_articles(vote: -1 | 1): Article[] {
  const rows = get_voted_stmt.all({ $like: vote }) as unknown as Article[];
  return rows.map(({ id, title, extract, url, like }) => ({ id, title, extract, url, like }));
}
