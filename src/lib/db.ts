import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { db_path } from './paths';

// ── Types ──────────────────────────────────────────────────────────────────

interface BaseFeedItem {
  id: number;
  title: string;
  url: string;
  like: -1 | 0 | 1;
}

export interface Article extends BaseFeedItem {
  type: 'article';
  extract: string;
  description: string | null;
  image_url: string | null;
  categories: string[];
}

export interface Picture extends BaseFeedItem {
  type: 'picture';
  image_url: string;
  caption: string;
  credit: string | null;
}

export type FeedItem = Article | Picture;

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

// ── Database ────────────────────────────────────────────────────────────────

export let db: DatabaseSync;

let get_next_articles_stmt: StatementSync;
let mark_article_seen_stmt: StatementSync;
let set_article_like_stmt: StatementSync;
let get_voted_articles_stmt: StatementSync;
let get_next_pictures_stmt: StatementSync;
let mark_picture_seen_stmt: StatementSync;
let set_picture_like_stmt: StatementSync;
let get_voted_pictures_stmt: StatementSync;
let get_datasets_stmt: StatementSync;
let get_picture_dataset_stmt: StatementSync;
let get_picture_topics_stmt: StatementSync;
let get_top_levels_stmt: StatementSync;
let get_categories_stmt: StatementSync;
let get_topics_stmt: StatementSync;
let set_dataset_enabled_stmt: StatementSync;
let get_datasets_enabled_stmt: StatementSync;

export const init_db = () => {
  if (db) {
    return;
  }

  db = new DatabaseSync(db_path());

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

    CREATE TABLE IF NOT EXISTS pictures (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      title     TEXT    NOT NULL,
      url       TEXT    NOT NULL UNIQUE,
      image_url TEXT    NOT NULL,
      caption   TEXT    NOT NULL DEFAULT '',
      credit    TEXT
    );

    CREATE TABLE IF NOT EXISTS user_pictures (
      picture_id INTEGER PRIMARY KEY REFERENCES pictures(id),
      like       INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS picture_topics (
      picture_id INTEGER NOT NULL REFERENCES pictures(id),
      dataset    TEXT    NOT NULL,
      topic      TEXT    NOT NULL,
      PRIMARY KEY (picture_id, dataset, topic)
    );
  `);

  try {
    db.exec("ALTER TABLE pictures ADD COLUMN caption TEXT NOT NULL DEFAULT ''");
  } catch {}

  // ── Article queries ──────────────────────────────────────────────────────

  const VISIBLE_CATEGORIES_SUBQUERY = `
    (SELECT GROUP_CONCAT(c.name, '|||')
     FROM article_categories ac
     JOIN categories c ON ac.category_id = c.id
     WHERE ac.article_id = a.id AND c.hidden = 0)
  `;

  get_next_articles_stmt = db.prepare(`
    SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url,
           COALESCE(ua.like, 0) AS like,
           ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories
    FROM articles a
    LEFT JOIN user_articles ua ON a.id = ua.article_id
    WHERE ua.article_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM article_topics at
        LEFT JOIN user_settings us ON us.dataset = at.dataset
        WHERE at.article_id = a.id
        AND COALESCE(us.enabled, 1) = 1
      )
    ORDER BY RANDOM()
    LIMIT $limit
  `);

  mark_article_seen_stmt = db.prepare(
    'INSERT OR IGNORE INTO user_articles (article_id) VALUES ($article_id)'
  );

  set_article_like_stmt = db.prepare(
    'UPDATE user_articles SET like = $like WHERE article_id = $article_id'
  );

  get_voted_articles_stmt = db.prepare(`
    SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url, ua.like,
           ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories
    FROM articles a
    JOIN user_articles ua ON a.id = ua.article_id
    WHERE ua.like = $like
    ORDER BY a.id DESC
  `);

  // ── Picture queries ──────────────────────────────────────────────────────

  get_next_pictures_stmt = db.prepare(`
    SELECT p.id, p.title, p.url, p.image_url, p.caption, p.credit,
           COALESCE(up.like, 0) AS like
    FROM pictures p
    LEFT JOIN user_pictures up ON p.id = up.picture_id
    WHERE up.picture_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM picture_topics pt
        LEFT JOIN user_settings us ON us.dataset = pt.dataset
        WHERE pt.picture_id = p.id
        AND COALESCE(us.enabled, 1) = 1
      )
    ORDER BY RANDOM()
    LIMIT $limit
  `);

  mark_picture_seen_stmt = db.prepare(
    'INSERT OR IGNORE INTO user_pictures (picture_id) VALUES ($picture_id)'
  );

  set_picture_like_stmt = db.prepare(
    'UPDATE user_pictures SET like = $like WHERE picture_id = $picture_id'
  );

  get_voted_pictures_stmt = db.prepare(`
    SELECT p.id, p.title, p.url, p.image_url, p.caption, p.credit, up.like
    FROM pictures p
    JOIN user_pictures up ON p.id = up.picture_id
    WHERE up.like = $like
    ORDER BY p.id DESC
  `);

  // ── Topic / dataset queries ──────────────────────────────────────────────

  get_datasets_stmt = db.prepare(`
    SELECT
      d.name AS dataset,
      d.source_url,
      COUNT(DISTINCT t.article_id) AS article_count,
      COUNT(DISTINCT CASE WHEN ua.like =  1 THEN t.article_id END) AS liked,
      COUNT(DISTINCT CASE WHEN ua.like = -1 THEN t.article_id END) AS disliked
    FROM datasets d
    LEFT JOIN article_topics t ON t.dataset = d.name
    LEFT JOIN user_articles ua ON t.article_id = ua.article_id
    WHERE d.name NOT IN (SELECT DISTINCT dataset FROM picture_topics)
    GROUP BY d.name
    ORDER BY d.name
  `);

  get_picture_dataset_stmt = db.prepare(`
    SELECT
      d.name AS dataset,
      d.source_url,
      COUNT(DISTINCT pt.picture_id) AS article_count,
      COUNT(DISTINCT CASE WHEN up.like =  1 THEN pt.picture_id END) AS liked,
      COUNT(DISTINCT CASE WHEN up.like = -1 THEN pt.picture_id END) AS disliked
    FROM datasets d
    LEFT JOIN picture_topics pt ON pt.dataset = d.name
    LEFT JOIN user_pictures up ON pt.picture_id = up.picture_id
    WHERE d.name = ?
    GROUP BY d.name
  `);

  get_picture_topics_stmt = db.prepare(`
    SELECT
      pt.dataset,
      pt.topic,
      COUNT(pt.picture_id) AS article_count,
      COUNT(CASE WHEN up.like =  1 THEN 1 END) AS liked,
      COUNT(CASE WHEN up.like = -1 THEN 1 END) AS disliked
    FROM picture_topics pt
    LEFT JOIN user_pictures up ON pt.picture_id = up.picture_id
    GROUP BY pt.dataset, pt.topic
    ORDER BY pt.dataset, pt.topic
  `);

  get_top_levels_stmt = db.prepare(`
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

  get_categories_stmt = db.prepare(`
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

  get_topics_stmt = db.prepare(`
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

  set_dataset_enabled_stmt = db.prepare(
    'INSERT OR REPLACE INTO user_settings (dataset, enabled) VALUES ($dataset, $enabled)'
  );

  get_datasets_enabled_stmt = db.prepare(
    'SELECT d.name AS dataset, COALESCE(us.enabled, 1) AS enabled FROM datasets d LEFT JOIN user_settings us ON us.dataset = d.name ORDER BY d.name'
  );
};

// ── Row mappers ─────────────────────────────────────────────────────────────

type ArticleDbRow = Omit<Article, 'type' | 'categories'> & { visible_categories: string | null };
type PictureDbRow = Omit<Picture, 'type'>;

const row_to_article = (r: ArticleDbRow): Article => ({
  type: 'article',
  id: r.id,
  title: r.title,
  extract: r.extract,
  url: r.url,
  like: r.like,
  description: r.description,
  image_url: r.image_url,
  categories: r.visible_categories ? r.visible_categories.split('|||') : [],
});

const row_to_picture = (r: PictureDbRow): Picture => ({
  type: 'picture',
  id: r.id,
  title: r.title,
  url: r.url,
  like: r.like,
  image_url: r.image_url,
  caption: r.caption,
  credit: r.credit,
});

// ── Feed ────────────────────────────────────────────────────────────────────

const PICTURE_RATIO =
  process.env.FEED_PICTURE_RATIO !== undefined ? parseFloat(process.env.FEED_PICTURE_RATIO) : 0.2;

const get_next_articles_internal = (limit: number): Article[] => {
  init_db();
  const rows = get_next_articles_stmt.all({ $limit: limit }) as unknown as ArticleDbRow[];
  db.exec('BEGIN');
  for (const row of rows) {
    mark_article_seen_stmt.run({ $article_id: row.id });
  }
  db.exec('COMMIT');
  return rows.map(row_to_article);
};

const get_next_pictures_internal = (limit: number): Picture[] => {
  init_db();
  const rows = get_next_pictures_stmt.all({ $limit: limit }) as unknown as PictureDbRow[];
  db.exec('BEGIN');
  for (const row of rows) {
    mark_picture_seen_stmt.run({ $picture_id: row.id });
  }
  db.exec('COMMIT');
  return rows.map(row_to_picture);
};

// Merges articles and pictures into one list at the requested ratio. Evenly
// spaces pictures throughout the batch. Backfills with the other type when one
// source runs dry.
export const get_next_feed = (count: number): FeedItem[] => {
  const pics_wanted = Math.round(count * PICTURE_RATIO);
  const arts_wanted = count - pics_wanted;

  const pictures = get_next_pictures_internal(pics_wanted);
  const articles = get_next_articles_internal(
    arts_wanted + Math.max(0, pics_wanted - pictures.length)
  );

  // Even spacing: insert one picture every `step` articles
  const result: FeedItem[] = [];
  const step =
    pictures.length > 0 ? Math.floor(articles.length / (pictures.length + 1)) + 1 : Infinity;
  let pic_idx = 0;
  let art_idx = 0;
  let next_pic_at = step;

  while (result.length < count && (art_idx < articles.length || pic_idx < pictures.length)) {
    if (pic_idx < pictures.length && result.length >= next_pic_at) {
      result.push(pictures[pic_idx++]);
      next_pic_at += step;
    } else if (art_idx < articles.length) {
      result.push(articles[art_idx++]);
    } else {
      result.push(pictures[pic_idx++]);
    }
  }

  return result;
};

// ── Public API ──────────────────────────────────────────────────────────────

export const get_next_articles = (limit: number): Article[] => get_next_articles_internal(limit);

export const set_like = (type: 'article' | 'picture', id: number, value: -1 | 0 | 1) => {
  init_db();
  if (type === 'article') {
    set_article_like_stmt.run({ $article_id: id, $like: value });
  } else {
    set_picture_like_stmt.run({ $picture_id: id, $like: value });
  }
};

export const get_voted_articles = (vote: -1 | 1): Article[] => {
  init_db();
  const rows = get_voted_articles_stmt.all({ $like: vote }) as unknown as ArticleDbRow[];
  return rows.map(row_to_article);
};

export const get_voted_pictures = (vote: -1 | 1): Picture[] => {
  init_db();
  const rows = get_voted_pictures_stmt.all({ $like: vote }) as unknown as PictureDbRow[];
  return rows.map(row_to_picture);
};

export const set_dataset_enabled = (dataset: string, enabled: boolean) => {
  init_db();
  set_dataset_enabled_stmt.run({ $dataset: dataset, $enabled: enabled ? 1 : 0 });
};

export const get_datasets_enabled = (): Record<string, boolean> => {
  init_db();
  const rows = get_datasets_enabled_stmt.all() as unknown as { dataset: string; enabled: number }[];
  return Object.fromEntries(rows.map((r) => [r.dataset, r.enabled === 1]));
};

export const get_category_tree = (): CategoryTree => {
  init_db();
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
  init_db();
  const article_dataset_rows = get_datasets_stmt.all() as unknown as DatasetGroup[];
  const topic_rows = get_topics_stmt.all() as unknown as (TopicStat & { dataset: string })[];

  const pic_topic_rows = get_picture_topics_stmt.all() as unknown as (TopicStat & {
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

  for (const name of pic_datasets) {
    const row = get_picture_dataset_stmt.get(name) as DatasetGroup | undefined;
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
