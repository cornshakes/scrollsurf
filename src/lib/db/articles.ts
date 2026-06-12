import { type Article } from './types';
import { get_db } from './connection';
import { affinity_ctes, weighted_random_order_by } from './affinity';

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

const ARTICLE_AFFINITY_CTES = affinity_ctes({
  topics_table: 'article_topics',
  user_table: 'user_articles',
  item_id_col: 'article_id',
  item_type: 'article',
});

const ARTICLE_GET_NEXT_SQL = (order_by: string) => `
  ${ARTICLE_AFFINITY_CTES}
  SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url,
         COALESCE(ua.like, 0) AS like,
         ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories,
         ${ARTICLE_TOPICS_SUBQUERY} AS article_topics_str
  FROM articles a
  LEFT JOIN user_articles ua ON a.id = ua.article_id AND ua.user_id = $user_id
  LEFT JOIN item_affinity ia ON ia.item_id = a.id
  WHERE ua.article_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM article_topics at
      LEFT JOIN user_settings us ON us.dataset = at.dataset AND us.user_id = $user_id
      WHERE at.article_id = a.id
      AND COALESCE(us.enabled, 1) = 1
    )
  ${order_by}
  LIMIT $limit
`;

const ARTICLE_MARK_SEEN_SQL =
  'INSERT OR IGNORE INTO user_articles (user_id, article_id) VALUES ($user_id, $article_id)';

const ARTICLE_SET_LIKE_SQL = `
  INSERT INTO user_articles (user_id, article_id, like) VALUES ($user_id, $article_id, $like)
  ON CONFLICT(user_id, article_id) DO UPDATE SET like = excluded.like
`;

const ARTICLE_GET_VOTED_SQL = `
  SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url, ua.like,
         ${VISIBLE_CATEGORIES_SUBQUERY} AS visible_categories,
         ${ARTICLE_TOPICS_SUBQUERY} AS article_topics_str
  FROM articles a
  JOIN user_articles ua ON a.id = ua.article_id
  WHERE ua.like = $like AND ua.user_id = $user_id
  ORDER BY a.id DESC
`;

export const get_next_articles_internal = (
  limit: number,
  user_id: number | null,
  strength?: number
): Article[] => {
  const db = get_db();
  const get_next = db.prepare(ARTICLE_GET_NEXT_SQL(weighted_random_order_by(strength)));
  const mark_seen = db.prepare(ARTICLE_MARK_SEEN_SQL);
  const rows = get_next.all({ $limit: limit, $user_id: user_id }) as unknown as ArticleDbRow[];
  if (user_id !== null) {
    db.exec('BEGIN');
    for (const row of rows) {
      mark_seen.run({ $user_id: user_id, $article_id: row.id });
    }
    db.exec('COMMIT');
  }
  return rows.map(row_to_article);
};

export const get_next_articles = (limit: number, user_id: number | null): Article[] =>
  get_next_articles_internal(limit, user_id);

export const set_article_like = (id: number, value: -1 | 0 | 1, user_id: number) => {
  get_db().prepare(ARTICLE_SET_LIKE_SQL).run({ $user_id: user_id, $article_id: id, $like: value });
};

export const get_voted_articles = (vote: -1 | 1, user_id: number | null): Article[] => {
  const rows = get_db()
    .prepare(ARTICLE_GET_VOTED_SQL)
    .all({ $like: vote, $user_id: user_id }) as unknown as ArticleDbRow[];
  return rows.map(row_to_article);
};
