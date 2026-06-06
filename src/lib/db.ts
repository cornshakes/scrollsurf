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

export interface ArticleInput {
  title: string;
  extract: string;
  url: string;
  description: string | null;
  image_url: string | null;
  categories: { name: string; hidden: boolean }[];
}

export interface UnclassifiedArticle {
  id: number;
  title: string;
}

export interface TopicStat {
  topic: string;
  label: string;
  article_count: number;
  liked: number;
  disliked: number;
}

export interface TopicTree {
  roots: { name: string; topics: TopicStat[] }[];
}

const db = new DatabaseSync(path.join(process.cwd(), 'scrollsurf.db'));

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

const insert_article_stmt = db.prepare(
  'INSERT OR IGNORE INTO articles (title, extract, url, description, image_url) VALUES ($title, $extract, $url, $description, $image_url)'
);

const get_article_id_stmt = db.prepare('SELECT id FROM articles WHERE url = $url');

const insert_category_stmt = db.prepare(
  'INSERT OR IGNORE INTO categories (name, hidden) VALUES ($name, $hidden)'
);

const get_category_id_stmt = db.prepare('SELECT id FROM categories WHERE name = $name');

const insert_article_category_stmt = db.prepare(
  'INSERT OR IGNORE INTO article_categories (article_id, category_id) VALUES ($article_id, $category_id)'
);

const get_next_stmt = db.prepare(`
  SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url,
         COALESCE(ua.like, 0) AS like,
         ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories
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
  SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url, ua.like,
         ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories
  FROM articles a
  JOIN user_articles ua ON a.id = ua.article_id
  WHERE ua.like = $like
  ORDER BY a.id DESC
`);

const get_unclassified_stmt = db.prepare(`
  SELECT a.id, a.title
  FROM articles a
  JOIN user_articles ua ON a.id = ua.article_id
  WHERE a.id NOT IN (SELECT article_id FROM article_topics)
  LIMIT $limit
`);

const insert_article_topic_stmt = db.prepare(
  'INSERT OR IGNORE INTO article_topics (article_id, topic) VALUES ($article_id, $topic)'
);

const get_topics_stmt = db.prepare(`
  SELECT
    CASE WHEN instr(t.topic, '.') > 0
         THEN substr(t.topic, 1, instr(t.topic, '.') - 1)
         ELSE t.topic END AS root,
    t.topic AS topic,
    COUNT(t.article_id) AS article_count,
    COUNT(CASE WHEN ua.like =  1 THEN 1 END) AS liked,
    COUNT(CASE WHEN ua.like = -1 THEN 1 END) AS disliked
  FROM article_topics t
  LEFT JOIN user_articles ua ON t.article_id = ua.article_id
  GROUP BY t.topic
  ORDER BY root, article_count DESC
`);

type DbRow = Omit<Article, 'categories'> & { visible_categories: string | null };
type TopicRow = {
  root: string;
  topic: string;
  article_count: number;
  liked: number;
  disliked: number;
};

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

export const insert_articles = (articles: ArticleInput[]) => {
  db.exec('BEGIN');
  for (const a of articles) {
    insert_article_stmt.run({
      $title: a.title,
      $extract: a.extract,
      $url: a.url,
      $description: a.description,
      $image_url: a.image_url,
    });
    const article_row = get_article_id_stmt.get({ $url: a.url }) as { id: number };
    for (const cat of a.categories) {
      insert_category_stmt.run({ $name: cat.name, $hidden: cat.hidden ? 1 : 0 });
      const cat_row = get_category_id_stmt.get({ $name: cat.name }) as { id: number };
      insert_article_category_stmt.run({ $article_id: article_row.id, $category_id: cat_row.id });
    }
  }
  db.exec('COMMIT');
};

export const get_next_articles = (limit: number): Article[] => {
  const rows = get_next_stmt.all({ $limit: limit }) as unknown as DbRow[];
  db.exec('BEGIN');
  for (const row of rows) {
    mark_seen_stmt.run({ $article_id: row.id });
  }
  db.exec('COMMIT');
  return rows.map(row_to_article);
};

export const count_unseen = (): number => {
  return (count_unseen_stmt.get() as { count: number }).count;
};

export const set_like = (article_id: number, value: -1 | 0 | 1) => {
  set_like_stmt.run({ $article_id: article_id, $like: value });
};

export const get_voted_articles = (vote: -1 | 1): Article[] => {
  const rows = get_voted_stmt.all({ $like: vote }) as unknown as DbRow[];
  return rows.map(row_to_article);
};

export const get_unclassified_articles = (limit: number): UnclassifiedArticle[] => {
  return get_unclassified_stmt.all({ $limit: limit }) as unknown as UnclassifiedArticle[];
};

export const record_article_topics = (article_id: number, topics: string[]) => {
  db.exec('BEGIN');
  for (const topic of topics) {
    insert_article_topic_stmt.run({ $article_id: article_id, $topic: topic });
  }
  db.exec('COMMIT');
};

export const get_topic_tree = (): TopicTree => {
  const rows = get_topics_stmt.all() as unknown as TopicRow[];
  const map = new Map<string, TopicStat[]>();
  for (const r of rows) {
    let list = map.get(r.root);
    if (!list) {
      list = [];
      map.set(r.root, list);
    }
    const label = r.topic.startsWith(`${r.root}.`) ? r.topic.slice(r.root.length + 1) : r.topic;
    list.push({
      topic: r.topic,
      label,
      article_count: r.article_count,
      liked: r.liked,
      disliked: r.disliked,
    });
  }
  return {
    roots: Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, topics]) => ({ name, topics })),
  };
};
