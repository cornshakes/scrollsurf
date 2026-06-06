'use server';

import {
  insert_articles,
  get_next_articles,
  count_unseen,
  set_like,
  get_voted_articles,
  get_unclassified_articles,
  record_article_topics,
  get_topic_tree,
  type Article,
  type ArticleInput,
  type TopicTree,
} from '@/lib/db';

const TITLES_PER_RUN = 500;
const TITLES_PER_BATCH = 15;
const REPLENISH_THRESHOLD = 50;
const TOPICS_PER_SETTLE = 30;

type WikiCategory = { title: string; hidden?: string };
type WikiPage = {
  title: string;
  extract?: string;
  description?: string;
  thumbnail?: { source: string };
  categories?: WikiCategory[];
};

const api_fetch = async (params: URLSearchParams, host = 'en.wikipedia.org'): Promise<Response> => {
  while (true) {
    const res = await fetch(`https://${host}/w/api.php?${params}`, {
      headers: { 'User-Agent': 'scrollsurf/1.0' },
    });
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After');
      const delayMs = retryAfter
        ? isNaN(Number(retryAfter))
          ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
          : Number(retryAfter) * 1000
        : 1000;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }
    return res;
  }
};

const fetch_random_titles = async (count: number): Promise<string[]> => {
  const params = new URLSearchParams({
    action: 'query',
    list: 'random',
    rnnamespace: '0',
    rnlimit: String(count),
    format: 'json',
    origin: '*',
  });
  const res = await api_fetch(params);
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  const data = await res.json();
  return (data.query.random as { title: string }[]).map((p) => p.title);
};

const fetch_articles_for_titles = async (titles: string[]): Promise<ArticleInput[]> => {
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'extracts|description|pageimages|categories',
    exintro: '1',
    explaintext: '1',
    piprop: 'thumbnail',
    pithumbsize: '400',
    clprop: 'hidden',
    cllimit: '500',
    format: 'json',
    origin: '*',
  });
  const res = await api_fetch(params);
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  const data = await res.json();
  return Object.values(data.query.pages as Record<string, WikiPage>)
    .filter((p) => !!p.extract)
    .map((p) => ({
      title: p.title,
      extract: p.extract as string,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
      description: p.description ?? null,
      image_url: p.thumbnail?.source ?? null,
      categories: (p.categories ?? []).map((c) => ({
        name: c.title.replace(/^Category:/, ''),
        hidden: 'hidden' in c,
      })),
    }));
};

const populate_articles = async () => {
  const titles = await fetch_random_titles(TITLES_PER_RUN);
  for (let i = 0; i < titles.length; i += TITLES_PER_BATCH) {
    const articles = await fetch_articles_for_titles(titles.slice(i, i + TITLES_PER_BATCH));
    insert_articles(articles);
  }
};

export const get_next_wiki_articles = async (count: number): Promise<Article[]> => {
  const unseen = count_unseen();
  if (unseen === 0) {
    await populate_articles();
  } else if (unseen < REPLENISH_THRESHOLD) {
    populate_articles().catch(console.error);
  }
  const articles = get_next_articles(count);
  settle_topics().catch(console.error);
  return articles;
};

export const set_article_like = async (article_id: number, value: -1 | 0 | 1) => {
  set_like(article_id, value);
};

export const get_voted_wiki_articles = async (vote: -1 | 1): Promise<Article[]> => {
  return get_voted_articles(vote);
};

const fetch_revids = async (titles: string[]): Promise<Map<string, number>> => {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'revisions',
    rvprop: 'ids',
    titles: titles.join('|'),
    format: 'json',
    origin: '*',
  });
  const res = await api_fetch(params);
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  const data = await res.json();
  const pages = data.query.pages as Record<
    string,
    { title: string; revisions?: { revid: number }[] }
  >;
  const result = new Map<string, number>();
  for (const page of Object.values(pages)) {
    const revid = page.revisions?.[0]?.revid;
    if (revid) result.set(page.title, revid);
  }
  return result;
};

const fetch_article_topics = async (revid: number): Promise<string[]> => {
  while (true) {
    const res = await fetch(
      'https://api.wikimedia.org/service/lw/inference/v1/models/enwiki-articletopic:predict',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'scrollsurf/1.0 (michael.hopfner@icloud.com)',
        },
        body: JSON.stringify({ rev_id: revid, lang: 'en' }),
      }
    );
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      await new Promise((resolve) => setTimeout(resolve, (retryAfter || 1) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`LiftWing error: ${res.status}`);
    const data = await res.json();
    const score = data.enwiki.scores[String(revid)].articletopic.score;
    const prediction = score.prediction as string[];
    if (prediction.length > 0) return prediction;
    let best = '';
    let best_p = -1;
    for (const [topic, p] of Object.entries(score.probability as Record<string, number>)) {
      if (p > best_p) {
        best_p = p;
        best = topic;
      }
    }
    return best ? [best] : [];
  }
};

let settling = false;

const settle_topics = async () => {
  if (settling) return;
  settling = true;
  try {
    const articles = get_unclassified_articles(TOPICS_PER_SETTLE);
    if (articles.length === 0) return;
    const revids = await fetch_revids(articles.map((a) => a.title));
    for (const article of articles) {
      const revid = revids.get(article.title);
      if (!revid) continue;
      const topics = await fetch_article_topics(revid);
      if (topics.length > 0) record_article_topics(article.id, topics);
    }
  } finally {
    settling = false;
  }
};

export const get_wiki_topic_tree = async (): Promise<TopicTree> => {
  return get_topic_tree();
};
