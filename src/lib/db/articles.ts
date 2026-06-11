import { type StatementSync } from 'node:sqlite';
import { type Article } from './types';
import { get_db } from './connection';

const VISIBLE_CATEGORIES_SUBQUERY = `
  (SELECT GROUP_CONCAT(c.name, '|||')
   FROM article_categories ac
   JOIN categories c ON ac.category_id = c.id
   WHERE ac.article_id = a.id AND c.hidden = 0)
`;

const ARTICLE_TOPICS_SUBQUERY = `
  (SELECT GROUP_CONCAT(at2.dataset || '::' || at2.topic || '::' || COALESCE(d.source_url, ''), '|||')
   FROM article_topics at2
   LEFT JOIN datasets d ON d.name = at2.dataset
   WHERE at2.article_id = a.id)
`;

type ArticleDbRow = Omit<Article, 'type' | 'categories' | 'topics'> & {
  visible_categories: string | null;
  article_topics_str: string | null;
};

export const row_to_article = (r: ArticleDbRow): Article => ({
  type: 'article',
  id: r.id,
  title: r.title,
  extract: r.extract,
  url: r.url,
  like: r.like,
  description: r.description,
  image_url: r.image_url,
  categories: r.visible_categories ? r.visible_categories.split('|||') : [],
  topics: r.article_topics_str
    ? r.article_topics_str.split('|||').map((t) => {
        const parts = t.split('::');
        const dataset_url = parts.length >= 3 ? parts[parts.length - 1] || null : null;
        const dataset = parts[0];
        const topic = parts.slice(1, parts.length - 1).join('::');
        return { dataset, topic, dataset_url };
      })
    : [],
});

let stmts: {
  get_next: StatementSync;
  mark_seen: StatementSync;
  set_like: StatementSync;
  get_voted: StatementSync;
} | null = null;

const s = () => {
  if (stmts) {
    return stmts;
  }
  const db = get_db();
  stmts = {
    get_next: db.prepare(`
      SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url,
             COALESCE(ua.like, 0) AS like,
             ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories,
             ${ARTICLE_TOPICS_SUBQUERY} AS article_topics_str
      FROM articles a
      LEFT JOIN user_articles ua ON a.id = ua.article_id AND ua.user_id = $user_id
      WHERE ua.article_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM article_topics at
          LEFT JOIN user_settings us ON us.dataset = at.dataset AND us.user_id = $user_id
          WHERE at.article_id = a.id
          AND COALESCE(us.enabled, 1) = 1
        )
      ORDER BY RANDOM()
      LIMIT $limit
    `),
    mark_seen: db.prepare(
      'INSERT OR IGNORE INTO user_articles (user_id, article_id) VALUES ($user_id, $article_id)'
    ),
    set_like: db.prepare(
      `INSERT INTO user_articles (user_id, article_id, like) VALUES ($user_id, $article_id, $like)
       ON CONFLICT(user_id, article_id) DO UPDATE SET like = excluded.like`
    ),
    get_voted: db.prepare(`
      SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url, ua.like,
             ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories,
             ${ARTICLE_TOPICS_SUBQUERY} AS article_topics_str
      FROM articles a
      JOIN user_articles ua ON a.id = ua.article_id
      WHERE ua.like = $like AND ua.user_id = $user_id
      ORDER BY a.id DESC
    `),
  };
  return stmts;
};

export const get_next_articles_internal = (limit: number, user_id: number | null): Article[] => {
  const db = get_db();
  const rows = s().get_next.all({ $limit: limit, $user_id: user_id }) as unknown as ArticleDbRow[];
  if (user_id !== null) {
    db.exec('BEGIN');
    for (const row of rows) {
      s().mark_seen.run({ $user_id: user_id, $article_id: row.id });
    }
    db.exec('COMMIT');
  }
  return rows.map(row_to_article);
};

export const get_next_articles = (limit: number, user_id: number | null): Article[] =>
  get_next_articles_internal(limit, user_id);

export const set_article_like = (id: number, value: -1 | 0 | 1, user_id: number) => {
  s().set_like.run({ $user_id: user_id, $article_id: id, $like: value });
};

export const get_voted_articles = (vote: -1 | 1, user_id: number | null): Article[] => {
  const rows = s().get_voted.all({ $like: vote, $user_id: user_id }) as unknown as ArticleDbRow[];
  return rows.map(row_to_article);
};
