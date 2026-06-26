import { chunk } from 'es-toolkit';
import { DatabaseSync } from 'node:sqlite';

export const TOP_LEVELS = [
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

export interface RunCategorizeOptions {
  db_path: string;
  top_levels: string[];
  fetch_children: (category: string) => Promise<string[]>;
  fetch_parents_batch: (categories: string[]) => Promise<Map<string, string[]>>;
  read_source_categories: () => Set<string>;
  exclude_parent?: (name: string) => boolean;
}

const MAX_ROUNDS = 50;
const API_TITLE_LIMIT = 50;
const CHUNK_SIZE = 50;

interface Walk {
  start: string;
  visited: Set<string>;
  frontier: string[];
  result: string | null | undefined;
}

export const run_categorize = async (opts: RunCategorizeOptions): Promise<void> => {
  const db = new DatabaseSync(opts.db_path);

  db.exec(`
    CREATE TABLE IF NOT EXISTS category_hierarchy (
      category_name TEXT NOT NULL PRIMARY KEY,
      top_level     TEXT NOT NULL
    );
  `);

  const lookup_stmt = db.prepare(
    'SELECT top_level FROM category_hierarchy WHERE category_name = ?'
  );
  const insert_hierarchy_stmt = db.prepare(
    'INSERT OR IGNORE INTO category_hierarchy (category_name, top_level) VALUES (?, ?)'
  );

  const lookup = (category: string): string | undefined =>
    (lookup_stmt.get(category) as { top_level: string } | undefined)?.top_level;

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
            break;
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
        break;
      }

      const parents_of = new Map<string, string[]>();
      for (const slice of chunk(nodes, API_TITLE_LIMIT)) {
        for (const [name, parents] of await opts.fetch_parents_batch(slice)) {
          parents_of.set(name, parents);
        }
      }

      for (const [node, walks_here] of waiting) {
        const parents = parents_of.get(node) ?? [];
        for (const walk of walks_here) {
          if (walk.result !== undefined) {
            continue;
          }
          for (const parent of parents) {
            if (opts.exclude_parent?.(parent)) {
              continue;
            }
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
    db.exec(`
      CREATE TABLE IF NOT EXISTS bootstrap_done (
        category_name TEXT NOT NULL PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS bootstrap_depth1 (
        category_name TEXT NOT NULL PRIMARY KEY,
        top_level     TEXT NOT NULL
      );
    `);

    const is_done_stmt = db.prepare('SELECT 1 FROM bootstrap_done WHERE category_name = ?');
    const mark_done_stmt = db.prepare(
      'INSERT OR IGNORE INTO bootstrap_done (category_name) VALUES (?)'
    );
    const insert_depth1_stmt = db.prepare(
      'INSERT OR IGNORE INTO bootstrap_depth1 (category_name, top_level) VALUES (?, ?)'
    );

    db.exec('BEGIN');
    for (const tl of opts.top_levels) {
      insert_hierarchy_stmt.run(tl, tl);
    }
    db.exec('COMMIT');

    let depth1_new = 0;
    let depth1_skipped = 0;
    for (let i = 0; i < opts.top_levels.length; i++) {
      const tl = opts.top_levels[i];
      process.stdout.write(
        `\r[bootstrap] depth 1: ${i + 1}/${opts.top_levels.length} (${depth1_new} new, ${depth1_skipped} cached)...`
      );
      if (is_done_stmt.get(tl)) {
        depth1_skipped++;
        continue;
      }
      const children = await opts.fetch_children(tl);
      db.exec('BEGIN');
      for (const child of children) {
        insert_hierarchy_stmt.run(child, tl);
        insert_depth1_stmt.run(child, tl);
        depth1_new++;
      }
      mark_done_stmt.run(tl);
      db.exec('COMMIT');
    }

    const depth1 = db
      .prepare('SELECT category_name AS cat, top_level FROM bootstrap_depth1')
      .all() as { cat: string; top_level: string }[];
    process.stdout.write(
      `\n[bootstrap] depth 1 complete: ${depth1.length} entries (${depth1_new} new, ${depth1_skipped} top-levels cached)\n`
    );

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
      const children = await opts.fetch_children(cat);
      db.exec('BEGIN');
      for (const child of children) {
        insert_hierarchy_stmt.run(child, top_level);
        depth2_new++;
      }
      mark_done_stmt.run(cat);
      db.exec('COMMIT');
    }
    process.stdout.write(
      `\n[bootstrap] depth 2 complete: ${depth2_new} new, ${depth2_skipped} cached\n`
    );
  };

  await bootstrap();

  process.stdout.write('[categorize] reading categories from datasets...\n');
  const all_categories = opts.read_source_categories();
  process.stdout.write(`[categorize] ${all_categories.size} unique categories found in datasets\n`);

  const already_mapped = [...all_categories].filter((name) => lookup(name) !== undefined).length;
  const unmapped = [...all_categories].filter((name) => lookup(name) === undefined);

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

    db.exec('BEGIN');
    for (const cat of batch_cats) {
      const top_level = results.get(cat) ?? null;
      if (top_level) {
        insert_hierarchy_stmt.run(cat, top_level);
        mapped++;
      } else {
        failed++;
      }
    }
    db.exec('COMMIT');

    process.stdout.write(
      `\r[${mapped + failed}/${unmapped.length}] mapped ${mapped} failed ${failed}`
    );
  }

  const total = db.prepare('SELECT COUNT(*) AS n FROM category_hierarchy').get() as { n: number };
  process.stdout.write(
    `\n[categorize] done: ${mapped} mapped, ${failed} could not be mapped, ${total.n} total in DB\n`
  );
};
