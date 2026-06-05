'use server';

import {
  insert_articles,
  get_next_articles,
  count_unseen,
  set_like,
  get_voted_articles,
  type Article,
} from '@/lib/db';

const FETCH_BATCH_SIZE = 500;
const REPLENISH_THRESHOLD = 50;

async function populate_articles() {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'random',
    grnnamespace: '0',
    grnlimit: String(FETCH_BATCH_SIZE),
    prop: 'extracts',
    exintro: '1',
    explaintext: '1',
    format: 'json',
    origin: '*',
  });

  let res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': 'scrollsurf/1.0' },
  });

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After');
    const delayMs = Number(retryAfter) * 1000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'scrollsurf/1.0' },
    });
  }

  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  const data = await res.json();

  const articles = Object.values(
    data.query.pages as Record<string, { title: string; extract: string }>
  )
    .filter((p) => !!p.extract)
    .map((p) => ({
      title: p.title,
      extract: p.extract,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
    }));

  insert_articles(articles);
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
