import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

const REQUEST_DELAY_MS = 500;

const MAX_DEPTH = 10;
const BATCH_SIZE = 50;

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

const TOP_LEVELS = [
  'Society',
  'Geography',
  'History',
  'Arts',
  'Medicine',
  'Technology',
  'Nature',
  'Philosophy',
  'Religion',
  'Mathematics',
  'Recreation',
  'Sports',
  'Events',
  'Education',
  'Warfare',
  'Architecture',
  'Law',
  'Business',
  'Politics',
  'Science',
  'Communication',
  'Agriculture',
  'Food',
  'Crafts',
  'Transport',
  'Organizations',
  'Literature',
  'Music',
  'Film',
  'Games',
  'Internet',
  'Mythology',
  'Biology',
  'Chemistry',
];

const categories_db = new DatabaseSync(path.join(process.cwd(), 'datasets', 'categories.db'));

categories_db.exec(`
  CREATE TABLE IF NOT EXISTS category_hierarchy (
    category_name TEXT NOT NULL PRIMARY KEY,
    top_level     TEXT NOT NULL
  );
`);

const fetch_category_children = async (category: string): Promise<string[]> => {
  const params = new URLSearchParams({
    action: 'query',
    list: 'categorymembers',
    cmtitle: `Category:${category}`,
    cmtype: 'subcat',
    cmlimit: '500',
    format: 'json',
  });
  const data = (await api_fetch(params)) as {
    query: { categorymembers: { title: string }[] };
  };
  return data.query.categorymembers.map((m) => m.title.replace(/^Category:/, ''));
};

const fetch_category_parents = async (category: string): Promise<string[]> => {
  const params = new URLSearchParams({
    action: 'query',
    titles: `Category:${category}`,
    prop: 'categories',
    cllimit: '500',
    format: 'json',
  });
  const data = (await api_fetch(params)) as {
    query: { pages: Record<string, { categories?: { title: string }[] }> };
  };
  const page = Object.values(data.query.pages)[0];
  if (!page?.categories) return [];
  return page.categories.map((c) => c.title.replace(/^Category:/, ''));
};

const walk_up_hierarchy = async (category: string): Promise<string | null> => {
  const visited = new Set<string>();
  const queue = [category];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    if (visited.has(current) || visited.size >= MAX_DEPTH) continue;
    visited.add(current);

    const parents = await fetch_category_parents(current);
    for (const parent of parents) {
      const check = categories_db
        .prepare('SELECT top_level FROM category_hierarchy WHERE category_name = ?')
        .get(parent) as { top_level: string } | undefined;
      if (check) return check.top_level;
      queue.push(parent);
    }
  }

  return null;
};

const bootstrap = async () => {
  const check = categories_db.prepare('SELECT COUNT(*) cnt FROM category_hierarchy').get() as {
    cnt: number;
  };
  if (check.cnt > 0) {
    console.warn('[bootstrap] hierarchy already populated, skipping');
    return;
  }

  console.warn('[bootstrap] fetching Wikipedia category hierarchy...');
  const insert_stmt = categories_db.prepare(
    'INSERT OR IGNORE INTO category_hierarchy (category_name, top_level) VALUES (?, ?)'
  );

  categories_db.exec('BEGIN');
  for (const top_level of TOP_LEVELS) {
    process.stdout.write(`\r[${top_level}]...`);
    const children = await fetch_category_children(top_level);
    for (const child of children) {
      insert_stmt.run(child, top_level);
    }
    insert_stmt.run(top_level, top_level);
  }
  categories_db.exec('COMMIT');

  process.stdout.write('\n[bootstrap] complete\n');
};

const categorize_unmapped = async () => {
  process.stdout.write('[categorize] finding unmapped categories...\n');

  const unmapped = categories_db
    .prepare(
      `SELECT DISTINCT category_name FROM category_hierarchy
       WHERE category_name NOT IN (SELECT DISTINCT category_name FROM category_hierarchy WHERE top_level IN (SELECT DISTINCT top_level FROM category_hierarchy))`
    )
    .all() as { category_name: string }[];

  if (unmapped.length === 0) {
    process.stdout.write('[categorize] all categories mapped!\n');
    return;
  }

  process.stdout.write(`[categorize] ${unmapped.length} unmapped categories found\n`);

  const insert_hierarchy = categories_db.prepare(
    'INSERT OR IGNORE INTO category_hierarchy (category_name, top_level) VALUES (?, ?)'
  );

  let mapped = 0;
  let failed = 0;

  categories_db.exec('BEGIN');

  for (let i = 0; i < unmapped.length; i += BATCH_SIZE) {
    const batch = unmapped.slice(i, i + BATCH_SIZE);

    for (const cat of batch) {
      process.stdout.write(
        `\r[${i + batch.indexOf(cat) + 1}/${unmapped.length}] ${cat.category_name.slice(0, 40)}...`
      );

      const top_level = await walk_up_hierarchy(cat.category_name);
      if (top_level) {
        insert_hierarchy.run(cat.category_name, top_level);
        mapped++;
      } else {
        failed++;
      }
    }

    if ((i + batch.length) % 100 === 0) {
      categories_db.exec('COMMIT');
      categories_db.exec('BEGIN');
    }
  }

  categories_db.exec('COMMIT');

  process.stdout.write(
    `\n[categorize] done: ${mapped} mapped, ${failed} unmapped (reached max depth or no parents)\n`
  );
};

const main = async () => {
  await bootstrap();
  await categorize_unmapped();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
