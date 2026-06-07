import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const BATCH_SIZE = 15;
const REQUEST_DELAY_MS = 500;

const SOURCE_URL = 'https://en.wikipedia.org/wiki/Wikipedia:Featured_articles';

const featured_db = new DatabaseSync(path.join(process.cwd(), 'datasets', 'featured_articles.db'));

featured_db.exec(`
  CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL
  );
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

featured_db
  .prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES ($key, $value)')
  .run({ $key: 'source_url', $value: SOURCE_URL });

const insert_article_stmt = featured_db.prepare(
  'INSERT OR IGNORE INTO articles (title, url, extract, description, image_url) VALUES ($title, $url, $extract, $description, $image_url)'
);
const insert_topic_stmt = featured_db.prepare(
  'INSERT OR IGNORE INTO article_topics (url, topic) VALUES ($url, $topic)'
);
const insert_category_stmt = featured_db.prepare(
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

interface TitleWithTopic {
  title: string;
  topic: string;
}

const get_article_titles_with_topics = async (): Promise<TitleWithTopic[]> => {
  const params = new URLSearchParams({
    action: 'parse',
    page: 'Wikipedia:Featured articles',
    prop: 'wikitext',
    format: 'json',
    formatversion: '2',
  });
  const data = (await api_fetch(params)) as { parse: { wikitext: string } };
  const results: TitleWithTopic[] = [];
  let current_topic: string | null = null;

  for (const line of data.parse.wikitext.split('\n')) {
    const heading = line.match(/^==\s*([^=]+)\s*==\s*$/);
    if (heading) {
      current_topic = heading[1].trim();
      continue;
    }
    if (!current_topic) continue;
    for (const m of line.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
      const target = m[1].trim();
      if (!target || target.includes(':')) continue;
      results.push({ title: target.replace(/_/g, ' '), topic: current_topic });
    }
  }

  return results;
};

const title_to_url = (title: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

const get_downloaded_urls = (): Set<string> => {
  const rows = featured_db.prepare('SELECT url FROM articles').all() as { url: string }[];
  return new Set(rows.map((r) => r.url));
};

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
  process.stdout.write('Phase 1: Collecting article URLs and topics...\n');
  const all_pairs = await get_article_titles_with_topics();
  const unique_titles = [...new Set(all_pairs.map((p) => p.title))];
  process.stdout.write(`Found ${unique_titles.length} unique articles.\n`);

  const downloaded = get_downloaded_urls();
  const to_download = all_pairs.filter((p) => !downloaded.has(title_to_url(p.title)));
  process.stdout.write(
    `${to_download.length} new articles to download (${all_pairs.length - to_download.length} already downloaded).\n`
  );
  if (to_download.length === 0) {
    process.stdout.write('Done.\n');
    return;
  }

  const topic_map = new Map<string, Set<string>>();
  for (const pair of to_download) {
    if (!topic_map.has(pair.title)) topic_map.set(pair.title, new Set());
    topic_map.get(pair.title)!.add(pair.topic);
  }
  const unique_to_download = [...topic_map.keys()];

  process.stdout.write('Phase 2: Downloading article content (extract, description, image)...\n');
  let saved = 0;
  featured_db.exec('BEGIN');
  for (let i = 0; i < unique_to_download.length; i += BATCH_SIZE) {
    const batch = unique_to_download.slice(i, i + BATCH_SIZE);
    const pages = await download_article_content(batch);

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
    process.stdout.write(`\r${saved} / ${unique_to_download.length} downloaded`);
  }
  featured_db.exec('COMMIT');

  process.stdout.write('\nDone.\n');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
