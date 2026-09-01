import { run_download_pictures, type DiscoveredPicture } from '../lib/pictures-dataset';
import {
  commons_api,
  commons_fetch_wikitext,
  commons_fetch_image_content,
  commons_fetch_categories,
} from '../lib/commons';
import { DISCOVERY_TTL_MS } from '../lib/mediawiki';

// Commons: namespace is namespace 4
const COMMONS_NS = 4;

// Strip basic wiki markup from a caption for clean display.
// [[link|label]] → label, [[link]] → link, ''text'' → text, <br> → space
const strip_markup = (s: string): string =>
  s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'{2,3}(.*?)'{2,3}/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Parses gallery blocks out of a page's wikitext.
const parse_gallery_wikitext = (wikitext: string): { file_title: string; caption: string }[] => {
  const results: { file_title: string; caption: string }[] = [];
  const gallery_re = /<gallery[^>]*>([\s\S]*?)<\/gallery>/gi;
  let gm: RegExpExecArray | null;
  while ((gm = gallery_re.exec(wikitext)) !== null) {
    for (const line of gm[1].split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.toLowerCase().startsWith('file:')) {
        continue;
      }
      const pipe_idx = trimmed.indexOf('|');
      const file_title = (pipe_idx >= 0 ? trimmed.slice(0, pipe_idx) : trimmed).trim();
      const caption_raw = pipe_idx >= 0 ? trimmed.slice(pipe_idx + 1) : '';
      results.push({ file_title, caption: strip_markup(caption_raw) || file_title });
    }
  }
  return results;
};

// Lists all Commons:Featured pictures/X subpages, filtering out chronological ones.
// Returns { title, topic } where topic is the first path segment after "Featured pictures/".
const fetch_subpages = async (): Promise<{ title: string; topic: string }[]> => {
  const pages: { title: string; topic: string }[] = [];
  let apcontinue: string | undefined;

  do {
    const params = new URLSearchParams({
      action: 'query',
      list: 'allpages',
      apprefix: 'Featured_pictures/',
      apnamespace: String(COMMONS_NS),
      aplimit: '500',
      format: 'json',
      formatversion: '2',
      ...(apcontinue ? { apcontinue } : {}),
    });

    // The subpage list grows as new galleries are added — must expire.
    const data = (await commons_api(params, { ttl_ms: DISCOVERY_TTL_MS })) as {
      query: { allpages: { title: string }[] };
      continue?: { apcontinue: string };
    };

    for (const { title } of data.query.allpages) {
      if (title.includes('/chronological')) {
        continue;
      }
      const rest = title.replace('Commons:Featured pictures/', '');
      const topic = rest.split('/')[0];
      if (topic) {
        pages.push({ title, topic });
      }
    }

    apcontinue = data.continue?.apcontinue;
  } while (apcontinue);

  return pages;
};

run_download_pictures({
  filename: 'commons_featured_pictures.db',
  title: 'Wikimedia Commons Featured Pictures',
  source_url: 'https://commons.wikimedia.org/wiki/Commons:Featured_pictures',
  fetch_image_info: commons_fetch_image_content,
  fetch_categories: commons_fetch_categories,
  discover: async () => {
    const subpages = await fetch_subpages();
    process.stdout.write(`Found ${subpages.length} gallery subpages.\n`);

    const results: DiscoveredPicture[] = [];

    for (let i = 0; i < subpages.length; i++) {
      const { title, topic } = subpages[i];
      process.stdout.write(`\r  Fetching subpage ${i + 1}/${subpages.length}: ${title}`);

      let wikitext: string;
      try {
        wikitext = await commons_fetch_wikitext(title);
      } catch {
        continue;
      }

      for (const { file_title, caption } of parse_gallery_wikitext(wikitext)) {
        results.push({ file_title, caption, credit: null, topic });
      }
    }
    process.stdout.write('\n');

    return results;
  },
});
