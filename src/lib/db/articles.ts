import { type Article, type Topic } from './types';
import { get_db } from './connection';
import { affinity_ctes, weighted_random_order_by } from './affinity';
import { fetch_topics_by_item } from './topics';

// Batch-fetch visible (non-hidden) category names. Returns article_id -> string[].
const fetch_visible_categories = (ids: number[]): Map<number, string[]> => {
  const by_id = new Map<number, string[]>();
  if (ids.length === 0) {
    return by_id;
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = get_db()
    .prepare(
      `SELECT ac.article_id AS item_id, c.name
       FROM article_categories ac
       JOIN categories c ON ac.category_id = c.id
       WHERE c.hidden = 0 AND ac.article_id IN (${placeholders})`
    )
    .all(...ids) as unknown as { item_id: number; name: string }[];
  for (const r of rows) {
    const list = by_id.get(r.item_id) ?? [];
    list.push(r.name);
    by_id.set(r.item_id, list);
  }
  return by_id;
};

type ArticleDbRow = Omit<Article, 'type' | 'categories' | 'topics'>;

export const row_to_article = (
  r: ArticleDbRow,
  topics: Topic[],
  categories: string[]
): Article => ({
  type: 'article',
  id: r.id,
  title: r.title,
  extract: r.extract,
  url: r.url,
  like: r.like,
  description: r.description,
  image_url: r.image_url,
  categories,
  topics,
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
         COALESCE(ua.like, 0) AS like
  FROM articles a
  LEFT JOIN user_articles ua ON a.id = ua.article_id AND ua.user_id = $user_id
  LEFT JOIN item_affinity ia ON ia.item_id = a.id
  WHERE ua.article_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM article_topics at
      WHERE at.article_id = a.id
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
  SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url, ua.like
  FROM articles a
  JOIN user_articles ua ON a.id = ua.article_id
  WHERE ua.like = $like AND ua.user_id = $user_id
  ORDER BY a.id DESC
`;

export const fetch_articles_by_ids = (ids: number[], user_id: number | null): Article[] => {
  if (ids.length === 0) {
    return [];
  }
  const placeholders = ids.map(() => '?').join(', ');
  const rows = get_db()
    .prepare(
      `SELECT a.id, a.title, a.extract, a.url, a.description, a.image_url,
              COALESCE(ua.like, 0) AS like
       FROM articles a
       LEFT JOIN user_articles ua ON a.id = ua.article_id AND ua.user_id = ?
       WHERE a.id IN (${placeholders})`
    )
    .all(user_id, ...ids) as unknown as ArticleDbRow[];
  const topics_by_id = fetch_topics_by_item('article_topics', 'article_id', ids);
  const cats_by_id = fetch_visible_categories(ids);
  const by_id = new Map(
    rows.map((r) => [
      r.id,
      row_to_article(r, topics_by_id.get(r.id) ?? [], cats_by_id.get(r.id) ?? []),
    ])
  );
  return ids.flatMap((id) => {
    const a = by_id.get(id);
    return a ? [a] : [];
  });
};

export const get_next_articles_internal = (
  limit: number,
  user_id: number | null,
  strength?: number
): Article[] => {
  const db = get_db();
  const get_next = db.prepare(ARTICLE_GET_NEXT_SQL(weighted_random_order_by(strength)));
  const mark_seen = db.prepare(ARTICLE_MARK_SEEN_SQL);
  const rows = get_next.all({ $limit: limit, $user_id: user_id }) as unknown as ArticleDbRow[];
  const ids = rows.map((r) => r.id);
  if (user_id !== null) {
    db.exec('BEGIN');
    for (const row of rows) {
      mark_seen.run({ $user_id: user_id, $article_id: row.id });
    }
    db.exec('COMMIT');
  }
  return fetch_articles_by_ids(ids, user_id);
};

export const get_next_articles = (limit: number, user_id: number | null): Article[] =>
  get_next_articles_internal(limit, user_id);

export const set_article_like = (id: number, value: -1 | 0 | 1, user_id: number) => {
  get_db().prepare(ARTICLE_SET_LIKE_SQL).run({ $user_id: user_id, $article_id: id, $like: value });
};

export const get_voted_articles = (vote: -1 | 1, user_id: number | null): Article[] => {
  const rows = get_db()
    .prepare(ARTICLE_GET_VOTED_SQL)
    .all({ $like: vote, $user_id: user_id }) as unknown as { id: number }[];
  return fetch_articles_by_ids(
    rows.map((r) => r.id),
    user_id
  );
};
