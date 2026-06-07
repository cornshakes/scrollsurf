import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const BATCH_SIZE = 15;
const REQUEST_DELAY_MS = 500;
const LIMIT = parseInt(process.env.DOWNLOAD_LIMIT ?? '') || Infinity;

const vital_db = new DatabaseSync(path.join(process.cwd(), 'vital_50000.db'));

vital_db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    title       TEXT NOT NULL,
    url         TEXT NOT NULL UNIQUE,
    extract     TEXT NOT NULL,
    description TEXT,
    image_url   TEXT
  );
  CREATE TABLE IF NOT EXISTS article_vital_topics (
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

const insert_article_stmt = vital_db.prepare(
  'INSERT OR IGNORE INTO articles (title, url, extract, description, image_url) VALUES ($title, $url, $extract, $description, $image_url)'
);
const insert_topic_stmt = vital_db.prepare(
  'INSERT OR IGNORE INTO article_vital_topics (url, topic) VALUES ($url, $topic)'
);
const insert_category_stmt = vital_db.prepare(
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

const api_fetch = async (params: URLSearchParams): Promise<Response> => {
  params.set('maxlag', '5');
  while (true) {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': 'scrollsurf/1.0 (michael.hopfner@icloud.com)' },
    });
    if (res.status === 429 || res.status === 503) {
      const retryAfter = res.headers.get('Retry-After');
      const delay = retryAfter
        ? isNaN(Number(retryAfter))
          ? Math.max(0, new Date(retryAfter).getTime() - Date.now())
          : Number(retryAfter) * 1000
        : 5000;
      await sleep(delay);
      continue;
    }
    await sleep(REQUEST_DELAY_MS);
    return res;
  }
};

// Phase 1: download article URLs — returns [title, topic] pairs
const download_article_urls_for_topic = async (
  topic: string,
  results: [string, string][]
): Promise<void> => {
  let cmcontinue: string | undefined;
  do {
    const params = new URLSearchParams({
      action: 'query',
      list: 'categorymembers',
      cmtitle: `Category:Wikipedia level-5 vital articles in ${topic}`,
      cmnamespace: '1',
      cmlimit: '500',
      format: 'json',
    });
    if (cmcontinue) params.set('cmcontinue', cmcontinue);

    const res = await api_fetch(params);
    if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
    const data = await res.json();

    for (const member of data.query.categorymembers as { title: string }[]) {
      results.push([member.title.replace(/^Talk:/, ''), topic]);
      process.stdout.write(`\r${results.length} article URLs found...`);
      if (results.length >= LIMIT) return;
    }

    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);
};

const VITAL_TOPICS = [
  'People',
  'History',
  'Geography',
  'Arts',
  'Philosophy and religion',
  'Everyday life',
  'Biology and health sciences',
  'Physical sciences',
  'Mathematics',
  'Technology',
  'Society and social sciences',
];

const download_all_article_urls = async (): Promise<[string, string][]> => {
  const results: [string, string][] = [];
  for (const topic of VITAL_TOPICS) {
    await download_article_urls_for_topic(topic, results);
    if (results.length >= LIMIT) break;
  }
  process.stdout.write('\n');
  return results;
};

const title_to_url = (title: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

const get_downloaded_urls = (): Set<string> => {
  const rows = vital_db.prepare('SELECT url FROM articles').all() as { url: string }[];
  return new Set(rows.map((r) => r.url));
};

// Phase 2: download article content (extract, description, image) for a batch of titles
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
  const res = await api_fetch(params);
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  const data = await res.json();
  return Object.values(data.query.pages as Record<string, WikiPage>).filter((p) => !!p.extract);
};

const main = async () => {
  process.stdout.write('Phase 1: Downloading article URLs from Wikipedia...\n');
  const all_pairs = await download_all_article_urls();

  const downloaded = get_downloaded_urls();
  const to_download = all_pairs.filter(([title]) => !downloaded.has(title_to_url(title)));
  process.stdout.write(
    `${to_download.length} new articles to download (${all_pairs.length - to_download.length} already downloaded).\n`
  );
  if (to_download.length === 0) {
    process.stdout.write('Done.\n');
    return;
  }

  // Deduplicate titles (an article can appear in multiple topics)
  const topic_map = new Map<string, Set<string>>();
  for (const [title, topic] of to_download) {
    if (!topic_map.has(title)) topic_map.set(title, new Set());
    topic_map.get(title)?.add(topic);
  }
  const unique_titles = [...topic_map.keys()];

  process.stdout.write('Phase 2: Downloading article content (extract, description, image)...\n');
  let saved = 0;
  for (let i = 0; i < unique_titles.length; i += BATCH_SIZE) {
    const batch = unique_titles.slice(i, i + BATCH_SIZE);
    const pages = await download_article_content(batch);

    vital_db.exec('BEGIN');
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
    vital_db.exec('COMMIT');

    process.stdout.write(`\r${saved} / ${unique_titles.length} downloaded`);
  }

  process.stdout.write('\nDone.\n');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
