import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const BATCH_SIZE = 15;
const REQUEST_DELAY_MS = 500;

const SOURCE_URL = 'https://en.wikipedia.org/wiki/Wikipedia:Good_articles';

const good_db = new DatabaseSync(path.join(process.cwd(), 'datasets', 'good_articles.db'));

good_db.exec(`
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
  CREATE TABLE IF NOT EXISTS discovered_articles (
    title TEXT NOT NULL PRIMARY KEY
  );
`);

good_db
  .prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES ($key, $value)')
  .run({ $key: 'source_url', $value: SOURCE_URL });

const insert_article_stmt = good_db.prepare(
  'INSERT OR IGNORE INTO articles (title, url, extract, description, image_url) VALUES ($title, $url, $extract, $description, $image_url)'
);
const insert_category_stmt = good_db.prepare(
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

const get_good_article_titles = async (): Promise<string[]> => {
  const titles: string[] = [];
  let cmcontinue: string | undefined;

  do {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: 'Category:Good articles',
      cmnamespace: '0',
      cmlimit: '500',
      format: 'json',
    });
    if (cmcontinue) params.set('cmcontinue', cmcontinue);

    const data = (await api_fetch(params)) as {
      query: { categorymembers: { title: string }[] };
      continue?: { cmcontinue: string };
    };

    for (const member of data.query.categorymembers) {
      titles.push(member.title);
      process.stdout.write(`\r${titles.length} articles found...`);
    }

    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);

  process.stdout.write('\n');
  return titles;
};

const title_to_url = (title: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

const get_downloaded_urls = (): Set<string> => {
  const rows = good_db.prepare('SELECT url FROM articles').all() as { url: string }[];
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

const urls_fetched_stmt = good_db.prepare("SELECT 1 FROM metadata WHERE key = 'urls_fetched'");
const set_urls_fetched_stmt = good_db.prepare(
  "INSERT OR REPLACE INTO metadata (key, value) VALUES ('urls_fetched', '1')"
);
const insert_discovered_stmt = good_db.prepare(
  'INSERT OR IGNORE INTO discovered_articles (title) VALUES (?)'
);

const main = async () => {
  let all_titles: string[];
  if (urls_fetched_stmt.get()) {
    const rows = good_db.prepare('SELECT title FROM discovered_articles').all() as {
      title: string;
    }[];
    all_titles = rows.map((r) => r.title);
    process.stdout.write(`Phase 1: Skipped (${all_titles.length} URLs already fetched).\n`);
  } else {
    process.stdout.write('Phase 1: Collecting article URLs...\n');
    all_titles = await get_good_article_titles();
    process.stdout.write(`Found ${all_titles.length} articles.\n`);
    good_db.exec('BEGIN');
    for (const t of all_titles) insert_discovered_stmt.run(t);
    set_urls_fetched_stmt.run();
    good_db.exec('COMMIT');
  }

  const downloaded = get_downloaded_urls();
  const to_download = all_titles.filter((t) => !downloaded.has(title_to_url(t)));
  process.stdout.write(
    `${to_download.length} new articles to download (${all_titles.length - to_download.length} already downloaded).\n`
  );
  if (to_download.length === 0) {
    process.stdout.write('Done.\n');
    return;
  }

  const unique_to_download = to_download;

  process.stdout.write('Phase 2: Downloading article content (extract, description, image)...\n');
  let saved = 0;
  for (let i = 0; i < unique_to_download.length; i += BATCH_SIZE) {
    const batch = unique_to_download.slice(i, i + BATCH_SIZE);
    const pages = await download_article_content(batch);

    good_db.exec('BEGIN');
    for (const p of pages) {
      const url = title_to_url(p.title);
      insert_article_stmt.run({
        $title: p.title,
        $url: url,
        $extract: p.extract as string,
        $description: p.description ?? null,
        $image_url: p.thumbnail?.source ?? null,
      });
      for (const cat of p.categories ?? []) {
        insert_category_stmt.run({
          $url: url,
          $name: cat.title.replace(/^Category:/, ''),
          $hidden: 'hidden' in cat ? 1 : 0,
        });
      }
      saved++;
    }
    good_db.exec('COMMIT');
    process.stdout.write(`\r${saved} / ${unique_to_download.length} downloaded`);
  }

  process.stdout.write('\nDone.\n');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
