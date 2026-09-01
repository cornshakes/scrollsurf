import { chunk } from 'es-toolkit';
import { decodeHTML } from 'entities';
import type { ImageInfo } from './wiki';
import { create_mediawiki_api, DISCOVERY_TTL_MS } from './mediawiki';

export const commons_api = create_mediawiki_api('https://commons.wikimedia.org/w/api.php');

export const commons_fetch_wikitext = async (page: string): Promise<string> => {
  const params = new URLSearchParams({
    action: 'parse',
    page,
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
  });
  // Gallery pages gain entries over time — must expire (see fetch_wikitext).
  const data = (await commons_api(params, { ttl_ms: DISCOVERY_TTL_MS })) as {
    parse: { wikitext: string };
  };
  return data.parse.wikitext;
};

const strip_html = (html: string): string => decodeHTML(html.replace(/<[^>]*>/g, '')).trim();

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

export const commons_fetch_categories = async (
  file_titles: string[]
): Promise<Map<string, string[]>> => {
  const results = new Map<string, string[]>();

  for (const batch of chunk(file_titles, 50)) {
    const params = new URLSearchParams({
      action: 'query',
      titles: batch.join('|'),
      prop: 'categories',
      clshow: '!hidden',
      cllimit: '500',
      format: 'json',
      formatversion: '2',
    });
    const data = (await commons_api(params)) as {
      query: {
        pages: {
          title: string;
          categories?: {
            title: string;
          }[];
        }[];
      };
    };

    for (const page of data.query.pages) {
      const categories =
        page.categories?.map((cat) => {
          const category_name = cat.title;
          return category_name.replace(/^Category:\s*/, '');
        }) ?? [];
      results.set(page.title, categories);
    }
  }

  return results;
};
