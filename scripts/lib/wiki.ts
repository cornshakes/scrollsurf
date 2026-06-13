import { create_mediawiki_api } from './mediawiki';

export const wiki_api = create_mediawiki_api('https://en.wikipedia.org/w/api.php');

// Mainspace titles may contain colons ("Star Trek: First Contact"); only skip
// links into a real namespace (File:, Category:, Wikipedia:, ...).
const NAMESPACE_RE =
  /^(?:Talk|User|Wikipedia|Project|WP|File|Image|Media|MediaWiki|Template|Help|Category|CAT|Portal|Draft|TimedText|Module|Special)(?:[ _]talk)?[ _]*:/i;
export const is_namespaced_link = (target: string): boolean => NAMESPACE_RE.test(target);

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
  const data = (await wiki_api(params)) as {
    parse?: { wikitext: string };
    error?: { code: string };
  };
  if (data.error) {
    throw new Error(data.error.code);
  }
  return data.parse?.wikitext ?? '';
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
    if (options.namespace !== undefined) {
      params.set('cmnamespace', String(options.namespace));
    }
    if (options.type) {
      params.set('cmtype', options.type);
    }
    if (cmcontinue) {
      params.set('cmcontinue', cmcontinue);
    }

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

// Fetches parent categories for up to 50 categories in one API call.
// Returns a map from (possibly normalized) category name to its parents.
export const fetch_category_parents_batch = async (
  categories: string[]
): Promise<Map<string, string[]>> => {
  const params = new URLSearchParams({
    action: 'query',
    titles: categories.map((c) => `Category:${c}`).join('|'),
    prop: 'categories',
    cllimit: '500',
    format: 'json',
  });
  const data = (await wiki_api(params)) as {
    query: {
      normalized?: { from: string; to: string }[];
      pages: Record<string, { title: string; categories?: { title: string }[] }>;
    };
  };

  // Map normalized titles back to the original requested name
  const denorm = new Map(
    (data.query.normalized ?? []).map((n) => [n.to, n.from.replace(/^Category:/, '')])
  );

  const result = new Map<string, string[]>();
  for (const page of Object.values(data.query.pages)) {
    const normalized_name = page.title.replace(/^Category:/, '');
    const name = denorm.get(page.title) ?? normalized_name;
    result.set(
      name,
      (page.categories ?? []).map((c) => c.title.replace(/^Category:/, ''))
    );
  }
  return result;
};

export interface ImageInfo {
  title: string; // File:Name.jpg
  thumburl: string; // 1000px thumbnail
  descriptionurl: string; // File description page
  credit?: string | null; // optional photographer credit
}

// Fetches image info (1000px thumbnail + description page) for a batch of File: titles.
// Returns only files that have a usable thumburl.
export const fetch_image_content = async (file_titles: string[]): Promise<ImageInfo[]> => {
  const params = new URLSearchParams({
    action: 'query',
    titles: file_titles.join('|'),
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '1000',
    format: 'json',
    formatversion: '2',
  });
  const data = (await wiki_api(params)) as {
    query: {
      pages: {
        title: string;
        imageinfo?: { thumburl?: string; descriptionurl?: string }[];
      }[];
    };
  };

  const results: ImageInfo[] = [];
  for (const page of data.query.pages) {
    const info = page.imageinfo?.[0];
    if (info?.thumburl && info?.descriptionurl) {
      results.push({
        title: page.title,
        thumburl: info.thumburl,
        descriptionurl: info.descriptionurl,
      });
    }
  }
  return results;
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
