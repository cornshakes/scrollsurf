'use server';

export interface WikiSummary {
  title: string;
  extract: string;
  url: string;
}

export async function getRandomWikiArticle(): Promise<WikiSummary> {
  const res = await fetch('https://en.wikipedia.org/api/rest_v1/page/random/summary', {
    headers: { 'User-Agent': 'scrollsurf/1.0' },
  });
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  const data = await res.json();
  return {
    title: data.title,
    extract: data.extract,
    url:
      data.content_urls?.desktop?.page ??
      `https://en.wikipedia.org/wiki/${encodeURIComponent(data.title)}`,
  };
}
