'use server';

import {
  insert_articles,
  get_next_articles,
  count_unseen,
  set_like,
  get_voted_articles,
  type Article,
  type ArticleInput,
} from '@/lib/db';

const TITLES_PER_RUN = 500;
const TITLES_PER_BATCH = 15; // keeps total cats well under cllimit=500
const REPLENISH_THRESHOLD = 50;

type WikiCategory = { title: string; hidden?: string };
type WikiPage = {
  title: string;
  extract?: string;
  description?: string;
  thumbnail?: { source: string };
  categories?: WikiCategory[];
};

async function api_fetch(params: URLSearchParams): Promise<Response> {
  while (true) {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
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
}

async function fetch_random_titles(count: number): Promise<string[]> {
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
}

async function fetch_articles_for_titles(titles: string[]): Promise<ArticleInput[]> {
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
}

async function populate_articles() {
  const titles = await fetch_random_titles(TITLES_PER_RUN);
  for (let i = 0; i < titles.length; i += TITLES_PER_BATCH) {
    const articles = await fetch_articles_for_titles(titles.slice(i, i + TITLES_PER_BATCH));
    insert_articles(articles);
  }
}

export async function get_next_wiki_articles(count: number): Promise<Article[]> {
  const unseen = count_unseen();
  if (unseen === 0) {
    await populate_articles();
  } else if (unseen < REPLENISH_THRESHOLD) {
    populate_articles().catch(console.error);
  }
  return get_next_articles(count);
}

export async function set_article_like(article_id: number, value: -1 | 0 | 1) {
  set_like(article_id, value);
}

export async function get_voted_wiki_articles(vote: -1 | 1): Promise<Article[]> {
  return get_voted_articles(vote);
}
