import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export interface Article {
  id: number;
  title: string;
  extract: string;
  url: string;
}

const db = new DatabaseSync(path.join(process.cwd(), 'scrollsurf.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT    NOT NULL,
    extract TEXT  NOT NULL,
    url   TEXT    NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS seen (
    article_id INTEGER PRIMARY KEY REFERENCES articles(id)
  );
`);

const insert_stmt = db.prepare(
  'INSERT OR IGNORE INTO articles (title, extract, url) VALUES ($title, $extract, $url)'
);

const get_next_stmt = db.prepare(`
  SELECT a.id, a.title, a.extract, a.url
  FROM articles a
  LEFT JOIN seen s ON a.id = s.article_id
  WHERE s.article_id IS NULL
  LIMIT $limit
`);

const mark_seen_stmt = db.prepare('INSERT OR IGNORE INTO seen (article_id) VALUES ($article_id)');

const count_unseen_stmt = db.prepare(`
  SELECT COUNT(*) AS count
  FROM articles a
  LEFT JOIN seen s ON a.id = s.article_id
  WHERE s.article_id IS NULL
`);

export function insert_articles(articles: Omit<Article, 'id'>[]) {
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
  return rows.map(({ id, title, extract, url }) => ({ id, title, extract, url }));
}

export function count_unseen(): number {
  return (count_unseen_stmt.get() as { count: number }).count;
}
