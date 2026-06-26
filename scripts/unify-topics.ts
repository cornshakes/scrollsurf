/* eslint-disable no-console */
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS topic_buckets (
    dataset TEXT NOT NULL,
    topic   TEXT NOT NULL,
    bucket  TEXT NOT NULL,
    PRIMARY KEY (dataset, topic)
  )
`;

const normalize = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '');

const find_candidates = (topic: string, buckets: string[]): string[] => {
  const norm_topic = normalize(topic);
  return buckets.filter((b) => {
    const norm_b = normalize(b);
    return norm_b.includes(norm_topic) || norm_topic.includes(norm_b);
  });
};

const main = async () => {
  const show_all = process.argv.includes('--all');

  const data_dir = process.env.SCROLLSURF_DATA_DIR ?? '.';
  const db_path = path.join(data_dir, 'scrollsurf.db');
  const buckets_path = path.join(data_dir, 'datasets', 'topic_buckets.db');

  const src_db = new DatabaseSync(db_path);
  const pairs = src_db
    .prepare(
      `SELECT dataset, topic, COUNT(*) AS n
       FROM item_topics
       GROUP BY dataset, topic
       ORDER BY topic, dataset`
    )
    .all() as { dataset: string; topic: string; n: number }[];
  src_db.close();

  if (pairs.length === 0) {
    console.log('No topics found. Run the app at least once to populate item_topics.');
    return;
  }

  const sorted_topics = [...pairs].sort(
    (left, right) =>
      left.topic.localeCompare(right.topic) || left.dataset.localeCompare(right.dataset)
  );
  console.log(`\nAll topics (${sorted_topics.length}):`);
  for (const { dataset, topic } of sorted_topics) {
    console.log(`  ${topic} (${dataset})`);
  }

  const bkt_db = new DatabaseSync(buckets_path);
  bkt_db.exec(SCHEMA);

  const existing_rows = bkt_db
    .prepare('SELECT dataset, topic, bucket FROM topic_buckets')
    .all() as { dataset: string; topic: string; bucket: string }[];

  const mapped = new Map<string, string>();
  for (const row of existing_rows) {
    mapped.set(`${row.dataset}::${row.topic}`, row.bucket);
  }

  const bucket_set = new Set<string>(existing_rows.map((r) => r.bucket));

  const insert = bkt_db.prepare(
    'INSERT OR REPLACE INTO topic_buckets (dataset, topic, bucket) VALUES (?, ?, ?)'
  );

  const rl = readline.createInterface({ input, output });

  const unmapped = pairs.filter((p) => show_all || !mapped.has(`${p.dataset}::${p.topic}`));

  if (unmapped.length === 0) {
    console.log('All pairs already mapped. Pass --all to re-map existing pairs.');
    rl.close();
    bkt_db.close();
    return;
  }

  console.log(
    `\n${unmapped.length} pairs to process. Commands: Enter=accept, #=pick, text=new, s=skip, q=quit\n`
  );

  for (const { dataset, topic, n } of unmapped) {
    const buckets = [...bucket_set];
    const candidates = find_candidates(topic, buckets);

    // Exact normalized match → suggest it; otherwise default to topic name
    const exact_match = buckets.find((b) => normalize(b) === normalize(topic));
    const suggestion = exact_match ?? topic;

    const candidate_list = candidates.filter((c) => c !== suggestion);
    const all_candidates = exact_match ? candidate_list : candidates;

    console.log(`\n[${dataset}] ${topic} (${n} items)`);
    console.log(`  Suggestion: ${suggestion}`);
    if (all_candidates.length > 0) {
      all_candidates.forEach((c, idx) => console.log(`  ${idx + 1}. ${c}`));
    }

    const prompt_text =
      all_candidates.length > 0
        ? `  Enter / #(1-${all_candidates.length}) / text / s / q > `
        : `  Enter / text / s / q > `;

    const answer = await rl.question(prompt_text);
    const trimmed = answer.trim();

    if (trimmed === 'q') {
      console.log('Quit.');
      break;
    }

    if (trimmed === 's') {
      console.log('  Skipped.');
      continue;
    }

    let chosen: string;

    if (trimmed === '') {
      chosen = suggestion;
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= all_candidates.length) {
        chosen = all_candidates[num - 1];
      } else {
        chosen = trimmed;
      }
    }

    insert.run(dataset, topic, chosen);
    bucket_set.add(chosen);
    console.log(`  → ${chosen}`);
  }

  rl.close();
  bkt_db.close();
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
