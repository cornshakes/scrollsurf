import * as cheerio from 'cheerio';
import {
  open_quotes_db,
  needs_discovery,
  record_months,
  get_undone_months,
  mark_month_done,
  insert_discovered_quotes,
  finalize_quotes,
  get_author_urls_needing_images,
  record_author_images,
  apply_author_images,
  type DiscoveredQuote,
  type AuthorImage,
} from '../lib/quotes-dataset';
import { create_mediawiki_api } from '../lib/mediawiki';

export const wikiquote_api = create_mediawiki_api('https://en.wikiquote.org/w/api.php');

const WIKIQUOTE_BASE = 'https://en.wikiquote.org';
const DEFAULT_YEAR_COUNT = 3;

const current_year = new Date().getFullYear();
const YEAR_MIN = current_year - DEFAULT_YEAR_COUNT + 1;
const YEAR_MAX = current_year;

// Author-image fetch: pageimages allows 50 titles per request, so batch and size
// the requested thumbnail for a future card avatar.
const IMAGE_BATCH_SIZE = 50;
const AUTHOR_THUMB_SIZE = 200;

// A clean day-archive link such as /wiki/Wikiquote:Quote_of_the_day/June_1,_2024
// is the natural key for items.url and the per-day anchor. The sibling
// "discussion"/"history" links use other URL shapes, so this exact pattern picks
// out the single "view" link per day.
const DAY_ARCHIVE_HREF = /^\/wiki\/Wikiquote:Quote_of_the_day\/[A-Za-z]+_\d{1,2},_\d{4}$/;

// Fetch monthly QOTD subpage titles from the index page.
// Filters to titles matching "Wikiquote:Quote of the day/Month YYYY" in [YEAR_MIN, YEAR_MAX].
const fetch_month_pages = async (): Promise<string[]> => {
  const results: string[] = [];
  let plcontinue: string | undefined;

  do {
    const params = new URLSearchParams({
      action: 'query',
      titles: 'Wikiquote:QOTD by month',
      prop: 'links',
      plnamespace: '4',
      pllimit: '500',
      format: 'json',
      formatversion: '2',
    });
    if (plcontinue) {
      params.set('plcontinue', plcontinue);
    }

    const data = (await wikiquote_api(params)) as {
      query: { pages: Array<{ links?: Array<{ title: string }> }> };
      continue?: { plcontinue: string };
    };

    const links = data.query.pages[0]?.links ?? [];
    for (const link of links) {
      const m = link.title.match(/^Wikiquote:Quote of the day\/([A-Za-z]+) (\d{4})$/);
      if (m) {
        const year = parseInt(m[2], 10);
        if (year >= YEAR_MIN && year <= YEAR_MAX) {
          results.push(link.title);
        }
      }
    }

    plcontinue = data.continue?.plcontinue;
  } while (plcontinue);

  return results.sort();
};

// Extract day-entry quotes from a monthly QOTD page's rendered HTML. Each day's
// quote table is immediately followed by a <p> holding a "view" link to the
// day-archive page; that link is the reliable per-day anchor and supplies the
// canonical URL (the natural key for items.url). Two table layouts are handled:
// the current `cquote` template (2026+) and the legacy `~ Name ~` form (≤2025).
const parse_month_html = (html: string): DiscoveredQuote[] => {
  const $ = cheerio.load(html);
  // <br> is a real line break in quote text — turn each into a space so adjacent
  // words keep their boundary once flattened to text (other inline tags need none).
  $('br').replaceWith(' ');

  const results: DiscoveredQuote[] = [];
  const seen_urls = new Set<string>();

  // Collapse whitespace and trim leading/trailing punctuation noise.
  const clean_quote = (raw: string): string =>
    raw
      .replace(/\s+/g, ' ')
      .replace(/^[^\p{L}\d"'"']+|[^\p{L}\d"'"'.!?]+$/gu, '')
      .trim();

  $('a').each((_index, anchor) => {
    const href = $(anchor).attr('href') ?? '';
    if (!DAY_ARCHIVE_HREF.test(href)) {
      return;
    }
    // Decode any percent-encoded characters (e.g. %2C → ,) and build canonical URL.
    const day_url = WIKIQUOTE_BASE + decodeURIComponent(href);
    if (seen_urls.has(day_url)) {
      return;
    }

    // The quote table is the one immediately preceding this view link's <p>.
    const table = $(anchor).closest('p').prevAll('table').first();
    if (!table.length) {
      return;
    }

    // cquote layout (current): author in a trailing <cite>; quote in the centre
    // cell between the two decorative quote-mark cells of the cquote table (which
    // may be the day table itself or nested inside it). Legacy layout (≤2025):
    // author in a `~ Name ~` cell, quote in the table row directly above it.
    let author = table.find('cite a[href^="/wiki/"]').first();
    const cquote = table.is('table.cquote') ? table : table.find('table.cquote').first();
    let quote = cquote.find('tr').first().children('td').eq(1);
    if (!author.length) {
      const tilde_cell = table
        .find('td')
        .filter((_position, cell) => /^\s*~/.test($(cell).text()))
        .first();
      author = tilde_cell.find('a[href^="/wiki/"]').first();
      quote = tilde_cell.closest('tr').prevAll('tr').first();
    }
    if (!author.length || !quote.length) {
      return;
    }

    const author_name = author.text().trim();
    const text = clean_quote(quote.text());
    if (!text || text.length < 5 || !author_name) {
      return;
    }

    seen_urls.add(day_url);
    results.push({
      url: day_url,
      text,
      author: author_name,
      author_url: WIKIQUOTE_BASE + (author.attr('href') ?? ''),
    });
  });

  return results;
};

// Fetch parsed HTML for a monthly QOTD page and extract its quote entries.
const fetch_month_quotes = async (page: string): Promise<DiscoveredQuote[]> => {
  const params = new URLSearchParams({
    action: 'parse',
    page,
    prop: 'text',
    format: 'json',
    formatversion: '2',
  });

  const data = (await wikiquote_api(params)) as {
    parse?: { text: string };
    error?: { code: string; info: string };
  };

  if (data.error) {
    throw new Error(`API error for "${page}": ${data.error.code} — ${data.error.info}`);
  }

  return parse_month_html(data.parse?.text ?? '');
};

const title_from_author_url = (url: string): string =>
  decodeURIComponent(url.replace(`${WIKIQUOTE_BASE}/wiki/`, '')).replace(/_/g, ' ');

const chunk = <T>(items: T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
};

// Fetch each author's Wikiquote page lead-image thumbnail via the pageimages API.
// Titles are batched and redirects followed, then every result is mapped back to
// its source author_url. Authors whose page has no image resolve to null. A batch
// that errors is skipped (its authors stay unrecorded and are retried next run).
const fetch_author_images = async (author_urls: string[]): Promise<AuthorImage[]> => {
  const results: AuthorImage[] = [];
  const batches = chunk(author_urls, IMAGE_BATCH_SIZE);

  for (const [index, batch] of batches.entries()) {
    process.stdout.write(`\r  batch ${index + 1}/${batches.length}                    `);
    const params = new URLSearchParams({
      action: 'query',
      titles: batch.map(title_from_author_url).join('|'),
      prop: 'pageimages',
      piprop: 'thumbnail',
      pithumbsize: String(AUTHOR_THUMB_SIZE),
      pilimit: String(IMAGE_BATCH_SIZE),
      redirects: '1',
      format: 'json',
      formatversion: '2',
    });

    let data: {
      query?: {
        normalized?: Array<{ from: string; to: string }>;
        redirects?: Array<{ from: string; to: string }>;
        pages?: Array<{ title: string; thumbnail?: { source: string } }>;
      };
    };
    try {
      data = (await wikiquote_api(params)) as typeof data;
    } catch (err) {
      process.stdout.write(`\n  Error fetching author-image batch ${index + 1}: ${err}\n`);
      continue;
    }

    // Follow title normalization + redirects so each requested title resolves to
    // the canonical page that actually carries the image.
    const forward = new Map<string, string>();
    for (const step of data.query?.normalized ?? []) {
      forward.set(step.from, step.to);
    }
    for (const step of data.query?.redirects ?? []) {
      forward.set(step.from, step.to);
    }
    const resolve_title = (title: string): string => {
      let current = title;
      for (let hop = 0; hop < 10 && forward.has(current); hop++) {
        current = forward.get(current) ?? current;
      }
      return current;
    };

    const thumb_by_title = new Map<string, string>();
    for (const page of data.query?.pages ?? []) {
      if (page.thumbnail) {
        thumb_by_title.set(page.title, page.thumbnail.source);
      }
    }

    for (const author_url of batch) {
      const resolved = resolve_title(title_from_author_url(author_url));
      results.push({ author_url, image: thumb_by_title.get(resolved) ?? null });
    }
  }

  return results;
};

const run = async (): Promise<void> => {
  const db = open_quotes_db('quotes.db');

  // Phase 1: Discover month pages
  if (needs_discovery(db)) {
    process.stdout.write(`Phase 1: Discovering month pages for years ${YEAR_MIN}–${YEAR_MAX}...\n`);
    const month_pages = await fetch_month_pages();
    if (month_pages.length === 0) {
      process.stdout.write(`No month pages found for years ${YEAR_MIN}–${YEAR_MAX}.\n`);
      return;
    }
    record_months(db, month_pages);
    process.stdout.write(`Found ${month_pages.length} month pages.\n`);
  } else {
    const undone = get_undone_months(db);
    process.stdout.write(`Phase 1: Skipped (${undone.length} months remaining).\n`);
  }

  // Phase 2: Download and parse each month
  const to_process = get_undone_months(db);
  process.stdout.write(`Phase 2: Downloading ${to_process.length} month pages...\n`);

  let processed = 0;
  let total_quotes = 0;

  for (const page of to_process) {
    process.stdout.write(`\r  ${processed + 1}/${to_process.length}: ${page}                    `);
    let quotes: DiscoveredQuote[];
    try {
      quotes = await fetch_month_quotes(page);
    } catch (err) {
      process.stdout.write(`\n  Error fetching "${page}": ${err}\n`);
      continue;
    }

    if (quotes.length === 0) {
      process.stdout.write(`\n  Warning: 0 quotes extracted from "${page}"\n`);
    }

    insert_discovered_quotes(db, quotes);
    mark_month_done(db, page);
    processed++;
    total_quotes += quotes.length;
  }

  process.stdout.write(`\n  Extracted ${total_quotes} quotes from ${processed} month(s).\n`);

  finalize_quotes(db);

  // Phase 3: Fetch author-page thumbnails (resumable via the author_images cache).
  const authors_needing = get_author_urls_needing_images(db);
  if (authors_needing.length > 0) {
    process.stdout.write(
      `Phase 3: Fetching author images for ${authors_needing.length} authors...\n`
    );
    const images = await fetch_author_images(authors_needing);
    record_author_images(db, images);
    apply_author_images(db);
    const found = images.filter((entry) => entry.image !== null).length;
    process.stdout.write(`\n  Found images for ${found}/${authors_needing.length} authors.\n`);
  } else {
    process.stdout.write('Phase 3: Author images already fetched.\n');
  }

  const total = (db.prepare('SELECT COUNT(*) AS n FROM quotes').get() as { n: number }).n;
  const with_image = (
    db.prepare('SELECT COUNT(*) AS n FROM quotes WHERE author_image IS NOT NULL').get() as {
      n: number;
    }
  ).n;
  process.stdout.write(
    `Total quotes in DB: ${total} (${with_image} with an author image).\nDone.\n`
  );
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
