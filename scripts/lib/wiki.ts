// Wikipedia API layer — shared by the dataset download scripts and categorize.
// Follows API:Etiquette: serial requests, maxlag, user-agent, gzip, json, backoff.

const REQUEST_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const retry_delay = (res: Response, fallback_ms: number): number => {
  const retryAfter = res.headers.get('Retry-After');
  if (!retryAfter) return fallback_ms;
  return isNaN(Number(retryAfter))
    ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
    : Number(retryAfter) * 1000;
};

export const wiki_api = async (params: URLSearchParams): Promise<unknown> => {
  params.set('maxlag', '5');
  while (true) {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: {
        'User-Agent': 'scrollsurf/1.0 (michael.hopfner@icloud.com)',
        'Accept-Encoding': 'gzip',
      },
    });
    if (res.status === 429 || res.status === 503) {
      await sleep(retry_delay(res, 5000));
      continue;
    }
    if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
    const data = await res.json();
    if (data?.error?.code === 'maxlag') {
      await sleep(retry_delay(res, 5000));
      continue;
    }
    await sleep(REQUEST_DELAY_MS);
    return data;
  }
};

export const title_to_url = (title: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

export const fetch_wikitext = async (page: string): Promise<string> => {
  const params = new URLSearchParams({
    action: 'parse',
    page,
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
  });
  const data = (await wiki_api(params)) as { parse: { wikitext: string } };
  return data.parse.wikitext;
};

interface CategoryMembersOptions {
  namespace?: number;
  type?: string; // e.g. 'subcat'
}

// Lists members of a category, following cmcontinue pagination. Returns titles
// (with the 'Category:' prefix stripped). on_progress is called with the
// running count after each page, for live logging.
export const fetch_category_members = async (
  category: string,
  options: CategoryMembersOptions = {},
  on_progress?: (count: number) => void
): Promise<string[]> => {
  const titles: string[] = [];
  let cmcontinue: string | undefined;
  do {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: category.startsWith('Category:') ? category : `Category:${category}`,
      cmlimit: '500',
      format: 'json',
    });
    if (options.namespace !== undefined) params.set('cmnamespace', String(options.namespace));
    if (options.type) params.set('cmtype', options.type);
    if (cmcontinue) params.set('cmcontinue', cmcontinue);

    const data = (await wiki_api(params)) as {
      query: { categorymembers: { title: string }[] };
      continue?: { cmcontinue: string };
    };
    for (const member of data.query.categorymembers) {
      titles.push(member.title.replace(/^Category:/, ''));
      on_progress?.(titles.length);
    }
    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);

  return titles;
};

export const fetch_category_parents = async (category: string): Promise<string[]> => {
  const params = new URLSearchParams({
    action: 'query',
    titles: `Category:${category}`,
    prop: 'categories',
    cllimit: '500',
    format: 'json',
  });
  const data = (await wiki_api(params)) as {
    query: { pages: Record<string, { categories?: { title: string }[] }> };
  };
  const page = Object.values(data.query.pages)[0];
  if (!page?.categories) return [];
  return page.categories.map((c) => c.title.replace(/^Category:/, ''));
};

export type WikiCategory = { title: string; hidden?: string };
export type WikiPage = {
  title: string;
  extract?: string;
  description?: string;
  thumbnail?: { source: string };
  categories?: WikiCategory[];
};

export interface ArticleContent {
  pages: WikiPage[];
  // Maps a requested title to the title Wikipedia actually resolved it to, after
  // first-letter normalization and redirect following (e.g. 'iMac G3' -> 'IMac
  // G3', 'SS Arctic disaster' -> 'SS Arctic'). Identity if no remapping applied.
  resolve: (title: string) => string;
}

// Fetches article content (intro extract, description, thumbnail, categories)
// for a batch of titles. Resolves redirects + title normalization so callers can
// map their requested titles back to the returned pages. Only pages with an
// extract are returned.
export const fetch_article_content = async (titles: string[]): Promise<ArticleContent> => {
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    redirects: '1',
    prop: 'extracts|description|pageimages|categories',
    exintro: '1',
    explaintext: '1',
    piprop: 'thumbnail',
    pithumbsize: '400',
    clprop: 'hidden',
    cllimit: '500',
    format: 'json',
  });
  const data = (await wiki_api(params)) as {
    query: {
      normalized?: { from: string; to: string }[];
      redirects?: { from: string; to: string }[];
      pages: Record<string, WikiPage>;
    };
  };

  const normalized = new Map((data.query.normalized ?? []).map((n) => [n.from, n.to]));
  const redirects = new Map((data.query.redirects ?? []).map((r) => [r.from, r.to]));
  const resolve = (title: string): string => {
    let t = normalized.get(title) ?? title;
    const seen = new Set<string>();
    while (redirects.has(t) && !seen.has(t)) {
      seen.add(t);
      t = redirects.get(t) ?? t;
    }
    return t;
  };

  const pages = Object.values(data.query.pages).filter((p) => !!p.extract);
  return { pages, resolve };
};
