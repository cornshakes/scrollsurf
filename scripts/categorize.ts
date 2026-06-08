import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { fetch_category_members, fetch_category_parents } from './lib/wiki';

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

const fetch_category_children = (category: string): Promise<string[]> =>
  fetch_category_members(category, { type: 'subcat' });

const MAX_DEPTH = 50;

const lookup_stmt = categories_db.prepare(
  'SELECT top_level FROM category_hierarchy WHERE category_name = ?'
);
const insert_hierarchy_stmt = categories_db.prepare(
  'INSERT OR IGNORE INTO category_hierarchy (category_name, top_level) VALUES (?, ?)'
);

const walk_up_hierarchy = async (category: string): Promise<string | null> => {
  const visited = new Set<string>();
  const queue = [category];

  const resolve = (top_level: string) => {
    for (const node of visited) insert_hierarchy_stmt.run(node, top_level);
    return top_level;
  };

  while (queue.length > 0 && visited.size < MAX_DEPTH) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;

    // Hit an already-mapped node — no API call needed
    const cached = lookup_stmt.get(current) as { top_level: string } | undefined;
    if (cached) return resolve(cached.top_level);

    visited.add(current);
    const parents = await fetch_category_parents(current);

    for (const parent of parents) {
      const check = lookup_stmt.get(parent) as { top_level: string } | undefined;
      if (check) return resolve(check.top_level);
      if (!visited.has(parent)) queue.push(parent);
    }
  }

  return null;
};

const bootstrap = async () => {
  categories_db.exec(`
    CREATE TABLE IF NOT EXISTS bootstrap_done (
      category_name TEXT NOT NULL PRIMARY KEY
    );
  `);

  const is_done_stmt = categories_db.prepare(
    'SELECT 1 FROM bootstrap_done WHERE category_name = ?'
  );
  const mark_done_stmt = categories_db.prepare(
    'INSERT OR IGNORE INTO bootstrap_done (category_name) VALUES (?)'
  );

  // Seed top-levels (idempotent)
  categories_db.exec('BEGIN');
  for (const tl of TOP_LEVELS) insert_hierarchy_stmt.run(tl, tl);
  categories_db.exec('COMMIT');

  // Depth 1: always re-run (only 34 API calls)
  const depth1: { cat: string; top_level: string }[] = [];
  for (let i = 0; i < TOP_LEVELS.length; i++) {
    const tl = TOP_LEVELS[i];
    process.stdout.write(`\r[bootstrap] depth 1: ${i + 1}/${TOP_LEVELS.length}...`);
    const children = await fetch_category_children(tl);
    categories_db.exec('BEGIN');
    for (const child of children) {
      insert_hierarchy_stmt.run(child, tl);
      depth1.push({ cat: child, top_level: tl });
    }
    categories_db.exec('COMMIT');
  }
  process.stdout.write(`\n[bootstrap] depth 1 complete: ${depth1.length} entries\n`);

  // Depth 2: skip categories whose children were already fetched
  let depth2_new = 0;
  let depth2_skipped = 0;
  for (let i = 0; i < depth1.length; i++) {
    const { cat, top_level } = depth1[i];
    process.stdout.write(
      `\r[bootstrap] depth 2: ${i + 1}/${depth1.length} (${depth2_new} new, ${depth2_skipped} cached)...`
    );
    if (is_done_stmt.get(cat)) {
      depth2_skipped++;
      continue;
    }
    const children = await fetch_category_children(cat);
    categories_db.exec('BEGIN');
    for (const child of children) {
      insert_hierarchy_stmt.run(child, top_level);
      depth2_new++;
    }
    mark_done_stmt.run(cat);
    categories_db.exec('COMMIT');
  }
  process.stdout.write(
    `\n[bootstrap] depth 2 complete: ${depth2_new} new, ${depth2_skipped} cached\n`
  );
};

const get_all_dataset_categories = (): Set<string> => {
  const datasets_dir = path.join(process.cwd(), 'datasets');
  const dbs = readdirSync(datasets_dir).filter((f) => f.endsWith('.db') && f !== 'categories.db');

  const all_categories = new Set<string>();
  for (const file of dbs) {
    const db = new DatabaseSync(path.join(datasets_dir, file));
    try {
      const rows = db
        .prepare('SELECT DISTINCT name FROM article_categories WHERE hidden = 0')
        .all() as { name: string }[];
      for (const row of rows) all_categories.add(row.name);
    } catch {
      // skip DBs without article_categories
    } finally {
      db.close();
    }
  }
  return all_categories;
};

const categorize = async () => {
  process.stdout.write('[categorize] reading categories from datasets...\n');
  const all_categories = get_all_dataset_categories();
  process.stdout.write(`[categorize] ${all_categories.size} unique categories found in datasets\n`);

  const is_mapped_stmt = categories_db.prepare(
    'SELECT 1 FROM category_hierarchy WHERE category_name = ?'
  );
  const insert_stmt = categories_db.prepare(
    'INSERT OR IGNORE INTO category_hierarchy (category_name, top_level) VALUES (?, ?)'
  );

  const already_mapped = [...all_categories].filter((name) => is_mapped_stmt.get(name)).length;
  const unmapped = [...all_categories].filter((name) => !is_mapped_stmt.get(name));

  process.stdout.write(
    `[categorize] ${already_mapped} already mapped, ${unmapped.length} to map\n`
  );
  if (unmapped.length === 0) return;

  let mapped = 0;
  let failed = 0;
  categories_db.exec('BEGIN');
  for (let i = 0; i < unmapped.length; i++) {
    process.stdout.write(
      `\r[${i + 1}/${unmapped.length}] mapped ${mapped} failed ${failed} — ${unmapped[i].slice(0, 40)}...`
    );
    const top_level = await walk_up_hierarchy(unmapped[i]);
    if (top_level) {
      insert_stmt.run(unmapped[i], top_level);
      mapped++;
    } else {
      failed++;
    }
    if ((i + 1) % 100 === 0) {
      categories_db.exec('COMMIT');
      categories_db.exec('BEGIN');
    }
  }
  categories_db.exec('COMMIT');

  const total = categories_db.prepare('SELECT COUNT(*) AS n FROM category_hierarchy').get() as {
    n: number;
  };
  process.stdout.write(
    `\n[categorize] done: ${mapped} mapped, ${failed} could not be mapped, ${total.n} total in DB\n`
  );
};

const main = async () => {
  await bootstrap();
  await categorize();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
