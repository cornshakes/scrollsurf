// Wikimedia Commons API layer — parallel to wiki.ts but for commons.wikimedia.org.
// Follows the same API:Etiquette rules (serial requests, maxlag, user-agent, gzip).

import type { ImageInfo } from './wiki';

const REQUEST_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const retry_delay = (res: Response, fallback_ms: number): number => {
  const retryAfter = res.headers.get('Retry-After');
  if (!retryAfter) {
    return fallback_ms;
  }
  return isNaN(Number(retryAfter))
    ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
    : Number(retryAfter) * 1000;
};

export const commons_api = async (params: URLSearchParams): Promise<unknown> => {
  params.set('maxlag', '5');
  const headers = {
    'User-Agent': 'scrollsurf/1.0 (michael.hopfner@icloud.com)',
    'Accept-Encoding': 'gzip',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  for (let attempt = 1; attempt <= 2; attempt++) {
    const last = attempt === 2;

    let res: Response;
    try {
      res = await fetch('https://commons.wikimedia.org/w/api.php', {
        method: 'POST',
        headers,
        body: params.toString(),
      });
    } catch (err) {
      if (last) {
        throw err;
      }
      console.warn(`[commons_api] connection error (${(err as Error).message}), retrying...`);
      await sleep(1000);
      continue;
    }

    if (res.status === 429 || res.status === 503) {
      if (last) {
        throw new Error(`Commons API error: ${res.status} (after retry)`);
      }
      console.warn(`[commons_api] ${res.status}, retrying...`);
      await sleep(retry_delay(res, 5000));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Commons API error: ${res.status}`);
    }

    const data = await res.json();
    if (data?.error?.code === 'maxlag') {
      if (last) {
        throw new Error('Commons API maxlag (after retry)');
      }
      console.warn('[commons_api] maxlag, retrying...');
      await sleep(retry_delay(res, 5000));
      continue;
    }

    await sleep(REQUEST_DELAY_MS);
    return data;
  }

  throw new Error('Commons API: unreachable');
};

export const commons_fetch_wikitext = async (page: string): Promise<string> => {
  const params = new URLSearchParams({
    action: 'parse',
    page,
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
  });
  const data = (await commons_api(params)) as { parse: { wikitext: string } };
  return data.parse.wikitext;
};

// Strip HTML tags and decode basic entities for clean plain-text credit.
const strip_html = (html: string): string =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();

export const commons_fetch_image_content = async (file_titles: string[]): Promise<ImageInfo[]> => {
  const params = new URLSearchParams({
    action: 'query',
    titles: file_titles.join('|'),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '1000',
    format: 'json',
    formatversion: '2',
  });
  const data = (await commons_api(params)) as {
    query: {
      pages: {
        title: string;
        imageinfo?: {
          thumburl?: string;
          descriptionurl?: string;
          extmetadata?: { Artist?: { value: string } };
        }[];
      }[];
    };
  };

  const results: ImageInfo[] = [];
  for (const page of data.query.pages) {
    const info = page.imageinfo?.[0];
    if (info?.thumburl && info?.descriptionurl) {
      const artist_html = info.extmetadata?.Artist?.value;
      results.push({
        title: page.title,
        thumburl: info.thumburl,
        descriptionurl: info.descriptionurl,
        credit: artist_html ? strip_html(artist_html) || null : null,
      });
    }
  }
  return results;
};
