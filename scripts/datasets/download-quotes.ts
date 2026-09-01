import * as cheerio from 'cheerio';
import {
  open_quotes_db,
  count_months,
  reopen_month,
  reopen_incomplete_months,
  record_months,
  get_undone_months,
  mark_month_done,
  insert_discovered_quotes,
  finalize_quotes,
  get_author_urls_needing_images,
  record_author_images,
  apply_author_images,
  get_author_urls_needing_times,
  get_quotes_for_author,
  apply_quote_times,
  get_source_urls_needing_times,
  get_undated_quotes_for_source,
  apply_source_times,
  type DiscoveredQuote,
  type AuthorImage,
} from '../lib/quotes-dataset';
import { create_mediawiki_api, DISCOVERY_TTL_MS } from '../lib/mediawiki';
import { skip_discovery } from '../lib/discovery';

export const wikiquote_api = create_mediawiki_api('https://en.wikiquote.org/w/api.php');

const WIKIQUOTE_BASE = 'https://en.wikiquote.org';

const current_year = new Date().getFullYear();
const YEAR_MIN = 2013;
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

const MONTH_NUMBERS: Record<string, string> = {
  january: '01',
  february: '02',
  march: '03',
  april: '04',
  may: '05',
  june: '06',
  july: '07',
  august: '08',
  september: '09',
  october: '10',
  november: '11',
  december: '12',
};

// The day-archive URL ends in "Month D, YYYY" (the day this quote was Quote of
// the Day). Parse it into an ISO date string, or null if the tail is unexpected.
const qotd_date_from_url = (day_url: string): string | null => {
  const tail = decodeURIComponent(day_url).split('/').pop() ?? '';
  const match = tail.replace(/_/g, ' ').match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  if (!match) {
    return null;
  }
  const month = MONTH_NUMBERS[match[1].toLowerCase()];
  if (!month) {
    return null;
  }
  return `${match[3]}-${month}-${match[2].padStart(2, '0')}`;
};

// Fetch monthly QOTD subpage titles from the index page.
// Maps each month page title to how many days that month has, so a partially
// parsed month can be detected. The current month is excluded — it is re-opened
// unconditionally and is not "incomplete" in the same sense.
const days_in_month_pages = (pages: string[]): Map<string, number> => {
  const current = current_month_page();
  const result = new Map<string, number>();
  for (const page of pages) {
    if (page === current) {
      continue;
    }
    const match = page.match(/\/([A-Za-z]+) (\d{4})$/);
    if (!match) {
      continue;
    }
    const month_index = MONTH_NAMES.indexOf(match[1]);
    if (month_index < 0) {
      continue;
    }
    result.set(page, new Date(Number(match[2]), month_index + 1, 0).getDate());
  }
  return result;
};

// The month page for today, in the same "Wikiquote:Quote of the day/Month YYYY"
// form fetch_month_pages produces.
const current_month_page = (): string => {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  return `Wikiquote:Quote of the day/${month} ${now.getFullYear()}`;
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Every month page title in [YEAR_MIN, YEAR_MAX] up to the current month —
// months beyond it cannot exist yet.
const expected_month_pages = (): string[] => {
  const now = new Date();
  const pages: string[] = [];
  for (let year = YEAR_MIN; year <= YEAR_MAX; year++) {
    const last_month = year === now.getFullYear() ? now.getMonth() : MONTH_NAMES.length - 1;
    for (let month = 0; month <= last_month; month++) {
      pages.push(`Wikiquote:Quote of the day/${MONTH_NAMES[month]} ${year}`);
    }
  }
  return pages;
};

// Keeps only the titles that exist on Wikiquote (batched, 50 titles per query).
const filter_existing_pages = async (titles: string[]): Promise<string[]> => {
  const existing: string[] = [];
  for (let index = 0; index < titles.length; index += 50) {
    const batch = titles.slice(index, index + 50);
    const params = new URLSearchParams({
      action: 'query',
      titles: batch.join('|'),
      format: 'json',
      formatversion: '2',
    });
    const data = (await wikiquote_api(params, { ttl_ms: DISCOVERY_TTL_MS })) as {
      query: { pages: Array<{ title: string; missing?: boolean }> };
    };
    for (const page of data.query.pages) {
      if (!page.missing) {
        existing.push(page.title);
      }
    }
  }
  return existing;
};

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

    const data = (await wikiquote_api(params, { ttl_ms: DISCOVERY_TTL_MS })) as {
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

  // "Wikiquote:QOTD by month" lags behind: as of writing it links only through
  // June 2026 while later month pages already exist. Month titles are fully
  // predictable, so union the index links with every month in range that really
  // exists — otherwise recent months would never be discovered.
  const extra = await filter_existing_pages(
    expected_month_pages().filter((page) => !results.includes(page))
  );

  return [...results, ...extra].sort();
};

// Extract day-entry quotes from a monthly QOTD page's rendered HTML. Each day's
// quote table is immediately followed by a <p> holding a "view" link to the
// day-archive page; that link is the reliable per-day anchor and supplies the
// canonical URL (the natural key for items.url). Two table layouts are handled:
// the current `cquote` template (2026+) and the legacy `~ Name ~` form (2013–2025).
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

    // cquote layout (2026+): attribution in a trailing <cite>; quote in the centre
    // cell between the two decorative quote-mark cells of the cquote table (which
    // may be the day table itself or nested inside it). Legacy layout (2013–2025):
    // attribution in a `~ Author ~ in ~ Work ~` cell, quote in the row above it.
    let attribution = table.find('cite').first();
    const cquote = table.is('table.cquote') ? table : table.find('table.cquote').first();
    let quote = cquote.find('tr').first().children('td').eq(1);
    if (!attribution.find('a[href^="/wiki/"]').length) {
      const tilde_cell = table
        .find('td')
        .filter((_position, cell) => /^\s*~/.test($(cell).text()))
        .first();
      attribution = tilde_cell;
      quote = tilde_cell.closest('tr').prevAll('tr').first();
    }
    const author = attribution.find('a[href^="/wiki/"]').first();
    if (!author.length || !quote.length) {
      return;
    }

    const author_name = author.text().trim();
    // Some day entries embed a decorative or author thumbnail inside the quote
    // cell; a broken-media embed renders its target ("File:Andrei Tarkovsky.jpg")
    // as literal text. Strip file embeds from a clone so neither the stored quote
    // nor the later first-words match is polluted by the filename.
    const quote_text = quote.clone();
    quote_text.find('[typeof~="mw:File"], a[href^="/wiki/File:"], img').remove();
    const text = clean_quote(quote_text.text());
    if (!text || text.length < 5 || !author_name) {
      return;
    }

    const author_href = author.attr('href') ?? '';
    // The work/theme page the quote is attributed to: the attribution container's
    // next wiki link after the author (the entity after "in ~ … ~"). Incidental
    // word-links in the quote body sit in a different cell, so the container's
    // links are just [author, work]. The page fragment points at a section, not a
    // page, so drop it.
    const source_href = attribution
      .find('a[href^="/wiki/"]')
      .toArray()
      .map((anchor) => $(anchor).attr('href') ?? '')
      .find((href) => href && !href.startsWith('/wiki/File:') && href !== author_href);

    seen_urls.add(day_url);
    results.push({
      url: day_url,
      text,
      author: author_name,
      author_url: WIKIQUOTE_BASE + author_href,
      qotd_date: qotd_date_from_url(day_url),
      source_url: source_href
        ? WIKIQUOTE_BASE + decodeURIComponent(source_href).split('#')[0]
        : null,
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

  // A month page gains an entry every day, so this must expire — an unexpiring
  // copy is what previously froze a month at the day it was first parsed.
  const data = (await wikiquote_api(params, { ttl_ms: DISCOVERY_TTL_MS })) as {
    parse?: { text: string };
    error?: { code: string; info: string };
  };

  if (data.error) {
    throw new Error(`API error for "${page}": ${data.error.code} — ${data.error.info}`);
  }

  return parse_month_html(data.parse?.text ?? '');
};

// The MediaWiki page title for a /wiki/ URL. Any `#section` fragment is dropped —
// it points at a section within the page, not a separate page to fetch.
const title_from_wiki_url = (url: string): string =>
  decodeURIComponent(url.replace(`${WIKIQUOTE_BASE}/wiki/`, '').split('#')[0]).replace(/_/g, ' ');

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
      titles: batch.map(title_from_wiki_url).join('|'),
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
      const resolved = resolve_title(title_from_wiki_url(author_url));
      results.push({ author_url, image: thumb_by_title.get(resolved) ?? null });
    }
  }

  return results;
};

// A quote's text reduced to a comparison key: lowercased, stripped of everything
// but ASCII letters/digits. Both the QOTD-stored text and the author-page list
// item are reduced the same way, so punctuation, accents, and whitespace
// differences between the two renderings drop out of the match.
const match_key = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');

// Minimum normalized length for a quote to be matched — guards against short
// fragments colliding across different quotes.
const MIN_MATCH_LEN = 12;
// Prefix length used as the needle; long enough to be unique, short enough to
// survive a trailing-word difference between the two renderings.
const MATCH_PREFIX_LEN = 40;

// The needle used to locate a stored quote within a page's text. QOTD entries
// frequently abridge a quote with an ellipsis ("In the life of each of us … there
// is a place remote and islanded"), so a fixed prefix of the whole quote can
// straddle the elided gap and never appear verbatim on the source page. Splitting
// on the ellipsis and keying on the longest unbroken segment yields the most
// reliable, most specific anchor; it is still capped at MATCH_PREFIX_LEN to
// survive a trailing-word difference. Returns null when no segment is long enough
// to match safely.
const match_needle = (text: string): string | null => {
  const longest_segment = text
    .split(/…|\.\.\./)
    .map(match_key)
    .reduce((longest, segment) => (segment.length > longest.length ? segment : longest), '');
  return longest_segment.length >= MIN_MATCH_LEN
    ? longest_segment.slice(0, MATCH_PREFIX_LEN)
    : null;
};

// Short opening-prefix length (~the first few words) used to locate a quote on a
// work page. Work pages reproduce a quote with occasional transcription
// differences past the opening — Four Quartets renders "wholy" for "wholly" — so
// a long needle (match_needle) straddles such a difference and fails to match.
// The opening few words are stable enough to anchor on, and the section header
// above the match supplies the year.
const SOURCE_PREFIX_LEN = 18;
const source_needle = (text: string): string | null => {
  const key = match_key(text);
  return key.length >= MIN_MATCH_LEN ? key.slice(0, SOURCE_PREFIX_LEN) : null;
};

// Pull an approximate date out of a section header. Author pages group quotes
// under year ("1933") or decade ("1920s") headers, and work-title subsections
// carry the year in parentheses ("Mein Weltbild (1931)"). Return the last such
// token (the parenthesized publication year wins over any year in the title),
// or null when the header carries no year.
const time_from_heading = (heading: string): string | null => {
  const year_re = /\b(1[0-9]{3}|20[0-9]{2})(s)?\b/g;
  let match: RegExpExecArray | null;
  let last: string | null = null;
  while ((match = year_re.exec(heading)) !== null) {
    last = match[1] + (match[2] ?? '');
  }
  return last;
};

// Walk the heading stack from the deepest level up, returning the first date a
// header yields — so a quote under "Quotes › 1930s › My Credo (1932)" dates to
// 1932, falling back to the decade if the subsection header has no year.
const time_from_stack = (stack: Record<number, string | null>): string | null => {
  for (let level = 4; level >= 2; level--) {
    const heading = stack[level];
    if (heading) {
      const time = time_from_heading(heading);
      if (time) {
        return time;
      }
    }
  }
  return null;
};

// Fallback date for a quote whose section header carries no year: the earliest
// year cited in its nested source/attribution sub-bullets (e.g. "Interview in
// Forbes (1 November 1974)" → 1974). The earliest year is the best proxy for
// when the quote originated, since reprints and collected editions cite later
// years. `nested_text` is the concatenated text of the <li>'s own nested lists
// only — never its lead line, so a year inside the quote itself is ignored.
const time_from_source = (nested_text: string): string | null => {
  const year_re = /\b(1[0-9]{3}|20[0-9]{2})\b/g;
  let match: RegExpExecArray | null;
  let earliest: number | null = null;
  while ((match = year_re.exec(nested_text)) !== null) {
    const year = parseInt(match[0], 10);
    if (earliest === null || year < earliest) {
      earliest = year;
    }
  }
  return earliest === null ? null : String(earliest);
};

// Parse an author page's rendered HTML into (match_key → quote_year) pairs. Walk
// the content root's children in document order, tracking the current h2/h3/h4
// header at each level. Each top-level <li> in a quote list is dated by the
// header stack above it, falling back to the earliest year in its own source
// sub-bullets. List items that yield no date either way are skipped.
const parse_author_times = (html: string): Map<string, string> => {
  const $ = cheerio.load(html);
  // <br> is a real line break in quote text — keep word boundaries when flattened.
  $('br').replaceWith(' ');

  const times = new Map<string, string>();
  const stack: Record<number, string | null> = { 2: null, 3: null, 4: null };

  $('.mw-parser-output')
    .first()
    .children()
    .each((_index, element) => {
      const node = $(element);
      const class_name = node.attr('class') ?? '';

      if (class_name.includes('mw-heading')) {
        const header = node.children('h2, h3, h4').first();
        const tag = (header.prop('tagName') ?? '').toLowerCase();
        const level = tag === 'h2' ? 2 : tag === 'h3' ? 3 : tag === 'h4' ? 4 : null;
        if (level) {
          stack[level] = header.text();
          for (let deeper = level + 1; deeper <= 4; deeper++) {
            stack[deeper] = null;
          }
        }
        return;
      }

      const header_time = time_from_stack(stack);

      if (element.tagName === 'ul') {
        node.children('li').each((_position, item) => {
          // Prefer the section-header year; otherwise fall back to the earliest
          // year cited in this <li>'s own nested source bullets.
          const time = header_time ?? time_from_source($(item).children('ul, ol, dl').text());
          if (!time) {
            return;
          }
          // Key on the whole <li>, nested translations and source citations
          // included: a QOTD entry often stores a translation that appears as a
          // sub-bullet here, and the match is a substring test, so the broader
          // text only widens recall. All sub-bullets share the entry's date.
          const key = match_key($(item).text());
          if (key.length >= MIN_MATCH_LEN && !times.has(key)) {
            times.set(key, time);
          }
        });
        return;
      }

      // Play dialogue, poems, and indented passages render as <p> or <dl> blocks
      // rather than list items (e.g. Samuel Beckett's "Waiting for Godot (1952) ›
      // Act II"). They carry no nested source bullets to fall back on, so date the
      // whole block only when its section header supplies a year.
      if ((element.tagName === 'p' || element.tagName === 'dl') && header_time) {
        const key = match_key(node.text());
        if (key.length >= MIN_MATCH_LEN && !times.has(key)) {
          times.set(key, header_time);
        }
      }
    });

  return times;
};

// Fetch one Wikiquote page (an author page or a work/theme page) and extract a
// quote_year for each given quote by matching it against the page's section
// headers / source bullets.
const fetch_quote_times_from_page = async (
  page_url: string,
  quotes: { url: string; text: string }[]
): Promise<{ url: string; quote_year: string }[]> => {
  const page = title_from_wiki_url(page_url);
  const params = new URLSearchParams({
    action: 'parse',
    page,
    prop: 'text',
    // Links are often redirects (e.g. "Ellen Page" → "Elliot Page"); follow them
    // so the parsed page is the one that actually carries the quotes.
    redirects: '1',
    format: 'json',
    formatversion: '2',
  });

  // A month page gains an entry every day, so this must expire — an unexpiring
  // copy is what previously froze a month at the day it was first parsed.
  const data = (await wikiquote_api(params, { ttl_ms: DISCOVERY_TTL_MS })) as {
    parse?: { text: string };
    error?: { code: string; info: string };
  };
  if (data.error) {
    throw new Error(`API error for "${page}": ${data.error.code} — ${data.error.info}`);
  }

  const times_by_key = parse_author_times(data.parse?.text ?? '');
  const results: { url: string; quote_year: string }[] = [];
  for (const quote of quotes) {
    const needle = match_needle(quote.text);
    if (!needle) {
      continue;
    }
    for (const [page_key, time] of times_by_key) {
      if (page_key.includes(needle)) {
        results.push({ url: quote.url, quote_year: time });
        break;
      }
    }
  }
  return results;
};

// Date the quotes attributed to one source/work page. Two work shapes occur:
// per-section works whose headers carry their own year (Four Quartets: "East Coker
// (1940)", "Little Gidding (1942)"), and single-year works organized by chapter
// (A Christmas Carol, "Staves" with one publication year in the lead). A quote is
// dated by the section header above its match when that header carries a year,
// otherwise by the work's single lead-paragraph year. Matching uses a short opening
// needle, since works reproduce a quote with occasional transcription differences
// past the opening. Only quotes whose text actually appears on the page are dated,
// guarding against an attribution that linked a person rather than a work.
const fetch_source_quote_times = async (
  source_url: string,
  quotes: { url: string; text: string }[]
): Promise<{ url: string; quote_year: string }[]> => {
  const page = title_from_wiki_url(source_url);
  const params = new URLSearchParams({
    action: 'parse',
    page,
    prop: 'text',
    redirects: '1',
    format: 'json',
    formatversion: '2',
  });

  const data = (await wikiquote_api(params)) as {
    parse?: { text: string; title: string };
    error?: { code: string; info: string };
  };
  if (data.error) {
    throw new Error(`API error for "${page}": ${data.error.code} — ${data.error.info}`);
  }

  const html = data.parse?.text ?? '';
  const $ = cheerio.load(html);
  $('br').replaceWith(' ');

  // Per-section years, keyed on each list item's text (same as author pages).
  const times_by_key = parse_author_times(html);

  // Lead paragraph → publication year fallback for chapter-organized works whose
  // section headers carry no year: prefer a year inside the first parenthetical
  // (the title's "(1922)"); otherwise the earliest year anywhere in the lead.
  const lead = $('.mw-parser-output')
    .first()
    .children('p')
    .filter((_index, paragraph) => $(paragraph).text().trim().length > 20)
    .first()
    .text();
  const paren_year = lead
    .match(/\(([^)]*\b(?:1[0-9]{3}|20[0-9]{2})\b[^)]*)\)/)?.[1]
    .match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[0];
  const lead_years = [...lead.matchAll(/\b(1[0-9]{3}|20[0-9]{2})\b/g)].map((match) =>
    Number(match[0])
  );
  const lead_year = paren_year ?? (lead_years.length ? String(Math.min(...lead_years)) : null);

  const page_key = match_key($('.mw-parser-output').first().text());
  const results: { url: string; quote_year: string }[] = [];
  for (const quote of quotes) {
    const needle = source_needle(quote.text);
    if (!needle) {
      continue;
    }
    // Prefer the year from the section header above the match; fall back to the
    // work's single lead year when the quote is on the page but its section is
    // undated.
    const section_year = [...times_by_key].find(([page_text]) => page_text.includes(needle))?.[1];
    const year = section_year ?? (page_key.includes(needle) ? lead_year : null);
    if (year) {
      results.push({ url: quote.url, quote_year: year });
    }
  }
  return results;
};

const run = async (): Promise<void> => {
  const db = open_quotes_db('quotes.db');

  // Phase 1: Discover month pages. This re-runs on every download so months
  // published since the last run are picked up; record_months is INSERT OR
  // IGNORE, so months already parsed keep their done flag.
  if (skip_discovery()) {
    const undone = get_undone_months(db);
    process.stdout.write(`Phase 1: Skipped by request (${undone.length} months remaining).\n`);
  } else {
    process.stdout.write(`Phase 1: Discovering month pages for years ${YEAR_MIN}–${YEAR_MAX}...\n`);
    const known_before = count_months(db);
    const month_pages = await fetch_month_pages();
    if (month_pages.length === 0) {
      process.stdout.write(`No month pages found for years ${YEAR_MIN}–${YEAR_MAX}.\n`);
      return;
    }
    record_months(db, month_pages);
    // A QOTD page gains one entry per day, so a month parsed while it was still
    // in progress is missing its later days. Re-parse the current month and any
    // past month whose stored quotes fall short of its length.
    reopen_month(db, current_month_page());
    const reopened = reopen_incomplete_months(db, days_in_month_pages(month_pages));
    process.stdout.write(
      `Found ${month_pages.length} month pages (${count_months(db) - known_before} new since last run` +
        `${reopened.length > 0 ? `, ${reopened.length} incomplete month(s) re-opened` : ''}).\n`
    );
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

  // Phase 4: Date each quote from its author page's section headers (resumable
  // via author_times_done — one parse per author covers all of their quotes).
  const authors_for_times = get_author_urls_needing_times(db);
  if (authors_for_times.length > 0) {
    process.stdout.write(
      `Phase 4: Extracting quote times from ${authors_for_times.length} author pages...\n`
    );
    let dated = 0;
    for (const [index, author_url] of authors_for_times.entries()) {
      process.stdout.write(`\r  ${index + 1}/${authors_for_times.length}                    `);
      const quotes = get_quotes_for_author(db, author_url);
      let times: { url: string; quote_year: string }[];
      try {
        times = await fetch_quote_times_from_page(author_url, quotes);
      } catch (err) {
        process.stdout.write(`\n  Error fetching times for "${author_url}": ${err}\n`);
        continue;
      }
      apply_quote_times(db, author_url, times);
      dated += times.length;
    }
    process.stdout.write(`\n  Dated ${dated} quotes.\n`);
  } else {
    process.stdout.write('Phase 4: Quote times already extracted.\n');
  }

  // Phase 5: Date the still-undated quotes from their source/work page (e.g. "A
  // Christmas Carol") — the quotes QOTD attributes to a work the author page
  // doesn't list. Resumable via source_times_done; source pages dedupe heavily.
  const sources_for_times = get_source_urls_needing_times(db);
  if (sources_for_times.length > 0) {
    process.stdout.write(
      `Phase 5: Extracting quote times from ${sources_for_times.length} source pages...\n`
    );
    let dated = 0;
    for (const [index, source_url] of sources_for_times.entries()) {
      process.stdout.write(`\r  ${index + 1}/${sources_for_times.length}                    `);
      const quotes = get_undated_quotes_for_source(db, source_url);
      let times: { url: string; quote_year: string }[];
      try {
        times = await fetch_source_quote_times(source_url, quotes);
      } catch (err) {
        process.stdout.write(`\n  Error fetching times for "${source_url}": ${err}\n`);
        continue;
      }
      apply_source_times(db, source_url, times);
      dated += times.length;
    }
    process.stdout.write(`\n  Dated ${dated} quotes.\n`);
  } else {
    process.stdout.write('Phase 5: Source-page times already extracted.\n');
  }

  const total = (db.prepare('SELECT COUNT(*) AS n FROM quotes').get() as { n: number }).n;
  const with_image = (
    db.prepare('SELECT COUNT(*) AS n FROM quotes WHERE author_image IS NOT NULL').get() as {
      n: number;
    }
  ).n;
  const with_time = (
    db.prepare('SELECT COUNT(*) AS n FROM quotes WHERE quote_year IS NOT NULL').get() as {
      n: number;
    }
  ).n;
  process.stdout.write(
    `Total quotes in DB: ${total} (${with_image} with an author image, ${with_time} dated).\nDone.\n`
  );
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
