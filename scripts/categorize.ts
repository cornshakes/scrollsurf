import { chunk } from 'es-toolkit';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { fetch_category_members, fetch_category_parents_batch } from './lib/wiki';

/*
 * The general idea of categorization: Walk 2 levels down from the top 34 categories, fanning out to ~23000 categories.
 * Then walk up from the existing article categories and try to find a parent category in few steps - usually it takes just 1 or 2.
 *
 * see 34 top level categories in https://en.wikipedia.org/wiki/Category:Main_topic_classifications
 *
 */

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

const MAX_ROUNDS = 50; // max levels walked up before giving up on a category
const API_TITLE_LIMIT = 50; // Wikipedia API title limit per request
const CHUNK_SIZE = 50; // starting categories walked together per walk_up_batch call

const lookup_stmt = categories_db.prepare(
  'SELECT top_level FROM category_hierarchy WHERE category_name = ?'
);
const insert_hierarchy_stmt = categories_db.prepare(
  'INSERT OR IGNORE INTO category_hierarchy (category_name, top_level) VALUES (?, ?)'
);

const lookup = (category: string): string | undefined =>
  (lookup_stmt.get(category) as { top_level: string } | undefined)?.top_level;

interface Walk {
  start: string;
  visited: Set<string>;
  frontier: string[];
  result: string | null | undefined; // undefined = still walking, null = dead-ended
}

// Walks several categories up the hierarchy together, pooling every active walk's
// BFS frontier into shared parent-fetch calls. Because most categories resolve in
// a single hop, round 0 carries ~CHUNK_SIZE titles in one API call instead of one
// title per call. On success a walk's visited ancestors are all cached, same as
// the old single-category walk did. Returns each start category's top-level (or null).
const walk_up_batch = async (categories: string[]): Promise<Map<string, string | null>> => {
  const walks: Walk[] = categories.map((start) => ({
    start,
    visited: new Set(),
    frontier: [start],
    result: undefined,
  }));

  const resolve = (walk: Walk, top_level: string) => {
    for (const node of walk.visited) {
      insert_hierarchy_stmt.run(node, top_level);
    }
    walk.result = top_level;
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Drain each active walk's frontier into a pooled set of nodes to fetch.
    // A node may be wanted by several walks, so map node -> walks waiting on it.
    const waiting = new Map<string, Walk[]>();
    for (const walk of walks) {
      if (walk.result !== undefined) {
        continue;
      }
      const frontier = walk.frontier;
      walk.frontier = [];
      for (const node of frontier) {
        if (walk.visited.has(node)) {
          continue;
        }
        const cached = lookup(node);
        if (cached) {
          resolve(walk, cached);
          break; // walk done; ignore the rest of its frontier
        }
        walk.visited.add(node);
        const list = waiting.get(node);
        if (list) {
          list.push(walk);
        } else {
          waiting.set(node, [walk]);
        }
      }
    }

    const nodes = [...waiting.keys()];
    if (nodes.length === 0) {
      break; // every walk has resolved or dead-ended
    }

    // Fetch parents for all pooled nodes, in API-sized chunks.
    const parents_of = new Map<string, string[]>();
    for (const slice of chunk(nodes, API_TITLE_LIMIT)) {
      for (const [name, parents] of await fetch_category_parents_batch(slice)) {
        parents_of.set(name, parents);
      }
    }

    // Hand each node's parents back to the walks that were waiting on it.
    for (const [node, walks_here] of waiting) {
      const parents = parents_of.get(node) ?? [];
      for (const walk of walks_here) {
        if (walk.result !== undefined) {
          continue;
        }
        for (const parent of parents) {
          const cached = lookup(parent);
          if (cached) {
            resolve(walk, cached);
            break;
          }
          if (!walk.visited.has(parent)) {
            walk.frontier.push(parent);
          }
        }
      }
    }
  }

  const out = new Map<string, string | null>();
  for (const walk of walks) {
    out.set(walk.start, walk.result ?? null);
  }
  return out;
};

const bootstrap = async () => {
  categories_db.exec(`
    CREATE TABLE IF NOT EXISTS bootstrap_done (
      category_name TEXT NOT NULL PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS bootstrap_depth1 (
      category_name TEXT NOT NULL PRIMARY KEY,
      top_level     TEXT NOT NULL
    );
  `);

  const is_done_stmt = categories_db.prepare(
    'SELECT 1 FROM bootstrap_done WHERE category_name = ?'
  );
  const mark_done_stmt = categories_db.prepare(
    'INSERT OR IGNORE INTO bootstrap_done (category_name) VALUES (?)'
  );
  const insert_depth1_stmt = categories_db.prepare(
    'INSERT OR IGNORE INTO bootstrap_depth1 (category_name, top_level) VALUES (?, ?)'
  );

  // Seed top-levels (idempotent)
  categories_db.exec('BEGIN');
  for (const tl of TOP_LEVELS) {
    insert_hierarchy_stmt.run(tl, tl);
  }
  categories_db.exec('COMMIT');

  // Depth 1: fetch each top-level's children once. The children are persisted to
  // bootstrap_depth1 and each top-level is marked done, so re-runs skip the fetch.
  let depth1_new = 0;
  let depth1_skipped = 0;
  for (let i = 0; i < TOP_LEVELS.length; i++) {
    const tl = TOP_LEVELS[i];
    process.stdout.write(
      `\r[bootstrap] depth 1: ${i + 1}/${TOP_LEVELS.length} (${depth1_new} new, ${depth1_skipped} cached)...`
    );
    if (is_done_stmt.get(tl)) {
      depth1_skipped++;
      continue;
    }
    const children = await fetch_category_children(tl);
    categories_db.exec('BEGIN');
    for (const child of children) {
      insert_hierarchy_stmt.run(child, tl);
      insert_depth1_stmt.run(child, tl);
      depth1_new++;
    }
    mark_done_stmt.run(tl);
    categories_db.exec('COMMIT');
  }

  const depth1 = categories_db
    .prepare('SELECT category_name AS cat, top_level FROM bootstrap_depth1')
    .all() as { cat: string; top_level: string }[];
  process.stdout.write(
    `\n[bootstrap] depth 1 complete: ${depth1.length} entries (${depth1_new} new, ${depth1_skipped} top-levels cached)\n`
  );

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
  if (unmapped.length === 0) {
    return;
  }

  let mapped = 0;
  let failed = 0;
  for (const batch_cats of chunk(unmapped, CHUNK_SIZE)) {
    const results = await walk_up_batch(batch_cats);

    categories_db.exec('BEGIN');
    for (const cat of batch_cats) {
      const top_level = results.get(cat) ?? null;
      if (top_level) {
        insert_stmt.run(cat, top_level);
        mapped++;
      } else {
        failed++;
      }
    }
    categories_db.exec('COMMIT');

    process.stdout.write(
      `\r[${mapped + failed}/${unmapped.length}] mapped ${mapped} failed ${failed}`
    );
  }

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
