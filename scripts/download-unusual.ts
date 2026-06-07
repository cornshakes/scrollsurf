import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const BATCH_SIZE = 15;
const REQUEST_DELAY_MS = 500;

// Sections of Wikipedia:Unusual articles to import, in page order, up to and
// including Military. Each is transcluded as a subpage {{/<Section>}}.
const LAST_SECTION = 'Military';

const unusual_db = new DatabaseSync(path.join(process.cwd(), 'unusual.db'));

unusual_db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    title       TEXT NOT NULL,
    url         TEXT NOT NULL UNIQUE,
    extract     TEXT NOT NULL,
    description TEXT,
    image_url   TEXT
  );
  CREATE TABLE IF NOT EXISTS article_topics (
    url   TEXT NOT NULL,
    topic TEXT NOT NULL,
    PRIMARY KEY (url, topic)
  );
  CREATE TABLE IF NOT EXISTS article_categories (
    url    TEXT NOT NULL,
    name   TEXT NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (url, name)
  );
`);

const insert_article_stmt = unusual_db.prepare(
  'INSERT OR IGNORE INTO articles (title, url, extract, description, image_url) VALUES ($title, $url, $extract, $description, $image_url)'
);
const insert_topic_stmt = unusual_db.prepare(
  'INSERT OR IGNORE INTO article_topics (url, topic) VALUES ($url, $topic)'
);
const insert_category_stmt = unusual_db.prepare(
  'INSERT OR IGNORE INTO article_categories (url, name, hidden) VALUES ($url, $name, $hidden)'
);

type WikiCategory = { title: string; hidden?: string };
type WikiPage = {
  title: string;
  extract?: string;
  description?: string;
  thumbnail?: { source: string };
  categories?: WikiCategory[];
};

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const retry_delay = (res: Response, fallback_ms: number): number => {
  const retryAfter = res.headers.get('Retry-After');
  if (!retryAfter) return fallback_ms;
  return isNaN(Number(retryAfter))
    ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
    : Number(retryAfter) * 1000;
};

const api_fetch = async (params: URLSearchParams): Promise<unknown> => {
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

const fetch_wikitext = async (page: string): Promise<string> => {
  const params = new URLSearchParams({
    action: 'parse',
    page,
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
  });
  const data = (await api_fetch(params)) as { parse: { wikitext: string } };
  return data.parse.wikitext;
};

// Phase 1: the section subpages transcluded by the main page, in order, up to
// and including LAST_SECTION (e.g. {{/History}} -> "History").
const get_section_names = async (): Promise<string[]> => {
  const wikitext = await fetch_wikitext('Wikipedia:Unusual articles');
  const sections: string[] = [];
  for (const m of wikitext.matchAll(/\{\{\/([^}]+)\}\}/g)) {
    const name = m[1].trim();
    sections.push(name);
    if (name === LAST_SECTION) return sections;
  }
  throw new Error(`Section "${LAST_SECTION}" not found in Wikipedia:Unusual articles`);
};

// Phase 2: the listed articles in a section are the bold-wrapped wikilinks
// '''[[Target]]''' / '''[[Target|display]]''' in the first table column.
// Inline links inside descriptions are not bold-wrapped, so they're excluded.
const get_article_titles_in_section = async (section: string): Promise<string[]> => {
  const wikitext = await fetch_wikitext(`Wikipedia:Unusual articles/${section}`);
  const titles: string[] = [];
  for (const m of wikitext.matchAll(/'''\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]'''/g)) {
    const target = m[1].trim();
    if (!target || target.includes(':')) continue; // skip File:/Category:/etc.
    titles.push(target.replace(/_/g, ' '));
  }
  return titles;
};

const title_to_url = (title: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

const get_downloaded_urls = (): Set<string> => {
  const rows = unusual_db.prepare('SELECT url FROM articles').all() as { url: string }[];
  return new Set(rows.map((r) => r.url));
};

// Phase 3: download article content (extract, description, image) for a batch of titles
const download_article_content = async (titles: string[]): Promise<WikiPage[]> => {
  const params = new URLSearchParams({
    action: 'query',
    titles: titles.join('|'),
    prop: 'extracts|description|pageimages|categories',
    exintro: '1',
    explaintext: '1',
    piprop: 'thumbnail',
    pithumbsize: '400',
    clprop: 'hidden',
    cllimit: '500',
    format: 'json',
  });
  const data = (await api_fetch(params)) as { query: { pages: Record<string, WikiPage> } };
  return Object.values(data.query.pages).filter((p) => !!p.extract);
};

const main = async () => {
  process.stdout.write('Phase 1: Reading section list from Wikipedia:Unusual articles...\n');
  const sections = await get_section_names();
  process.stdout.write(`${sections.length} sections (up to and including ${LAST_SECTION}).\n`);

  process.stdout.write('Phase 2: Collecting article URLs from each section...\n');
  // title -> set of section-name topics (an article may appear in several sections).
  // The "Unusual" dataset grouping is applied on import, not stored here.
  const topic_map = new Map<string, Set<string>>();
  for (const section of sections) {
    const titles = await get_article_titles_in_section(section);
    for (const title of titles) {
      if (!topic_map.has(title)) topic_map.set(title, new Set());
      topic_map.get(title)?.add(section);
    }
    process.stdout.write(`\r${topic_map.size} article URLs found...`);
  }
  process.stdout.write('\n');

  const downloaded = get_downloaded_urls();
  const to_download = [...topic_map.keys()].filter((t) => !downloaded.has(title_to_url(t)));
  process.stdout.write(
    `${to_download.length} new articles to download (${topic_map.size - to_download.length} already downloaded).\n`
  );
  if (to_download.length === 0) {
    process.stdout.write('Done.\n');
    return;
  }

  process.stdout.write('Phase 3: Downloading article content (extract, description, image)...\n');
  let saved = 0;
  for (let i = 0; i < to_download.length; i += BATCH_SIZE) {
    const batch = to_download.slice(i, i + BATCH_SIZE);
    const pages = await download_article_content(batch);

    unusual_db.exec('BEGIN');
    for (const p of pages) {
      const url = title_to_url(p.title);
      insert_article_stmt.run({
        $title: p.title,
        $url: url,
        $extract: p.extract as string,
        $description: p.description ?? null,
        $image_url: p.thumbnail?.source ?? null,
      });
      for (const topic of topic_map.get(p.title) ?? []) {
        insert_topic_stmt.run({ $url: url, $topic: topic });
      }
      for (const cat of p.categories ?? []) {
        insert_category_stmt.run({
          $url: url,
          $name: cat.title.replace(/^Category:/, ''),
          $hidden: 'hidden' in cat ? 1 : 0,
        });
      }
      saved++;
    }
    unusual_db.exec('COMMIT');

    process.stdout.write(`\r${saved} / ${to_download.length} downloaded`);
  }

  process.stdout.write('\nDone.\n');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
