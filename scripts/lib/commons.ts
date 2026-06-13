import { decodeHTML } from 'entities';
import type { ImageInfo } from './wiki';
import { create_mediawiki_api } from './mediawiki';

export const commons_api = create_mediawiki_api('https://commons.wikimedia.org/w/api.php');

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
