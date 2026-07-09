import { type FeedItem, type FeedItemType } from './types';
import { fetch_articles_by_ids } from './articles';
import { fetch_pictures_by_ids } from './pictures';
import { fetch_quotes_by_ids } from './quotes';
import { get_db } from './connection';
import { type BucketSet, load_weighted_bucket_sets } from './affinity';
import { groupBy, keyBy } from 'es-toolkit';

type Slot = {
  set_id: number;
  type: FeedItemType;
};

type SlotItem = {
  id: number;
  type: FeedItemType;
};

/**
 * Turns bucket sets and their weights into slots ready to be populated with random items.
 */
const draw_weighted_random_slots = (bucket_sets: BucketSet[], count: number) => {
  // I am told this is a weighted roulette wheel draw.
  // First, each group gets a number range proportional to its weight and eligible items.
  // |-group 1-|-------group 2----------|g3|--- group 4---| ...
  // then, I throw a dart and see what range it hits.
  // repeat 10 times to get 10 slots.
  const slots: Slot[] = [];
  for (let slot = 0; slot < count; slot++) {
    let total = 0;
    const ruler = bucket_sets.map((set) => (total += set.item_count * set.weight));
    if (total === 0) {
      // no more items to  serve
      break;
    }
    const dart = Math.random() * total;
    const hit = ruler.findIndex((n) => dart <= n);
    const chosen = bucket_sets[hit];
    chosen.item_count -= 1;
    slots.push({ set_id: chosen.set_id, type: chosen.type });
  }
  return slots;
};

/**
 * selects random unseen item ids of the desired type and bucket set.
 * @param type the type of the items to select
 * @param set_id the bucket set it of the items to select
 * @param user_id the user that should not have seen these items before
 * @param count the amount of items to return
 *
 */
const get_random_item_ids = (
  type: FeedItemType,
  set_id: number,
  user_id: number | null,
  count: number
) => {
  const rows = get_db()
    .prepare(
      `SELECT item_id FROM bucket_set_items
          WHERE type = $type AND set_id = $set_id
          AND item_id NOT IN (SELECT item_id FROM user_items WHERE user_id = $user_id)
          ORDER BY RANDOM()
          LIMIT $limit`
    )
    .all({
      $type: type,
      $set_id: set_id,
      $user_id: user_id,
      $limit: count,
    }) as unknown as { item_id: number }[];
  return rows.map((r) => r.item_id);
};

/**
 * Populates preapared slots with items.
 */
const populate_slots = (slots: Slot[], user_id: number | null): SlotItem[] => {
  const slot_key = (slot: Slot) => `${slot.type}:${slot.set_id}`;
  const item_ids_by_slot_key = new Map(
    // group slots that are the same
    Object.entries(groupBy(slots, slot_key)).map(([key, slots]) => {
      return [
        key,
        // get appropriate amount of item ids for each slot group
        get_random_item_ids(slots[0].type, slots[0].set_id, user_id, slots.length),
      ];
    })
  );

  // throw if my scheme doesn't work (and get proper typing)
  const pop_id = (slot: Slot) => {
    const id = item_ids_by_slot_key.get(slot_key(slot))?.pop();
    if (!id) {
      throw new Error("my scheme doesn't work");
    }
    return id;
  };

  return slots.map((s) => ({
    type: s.type,
    id: pop_id(s),
  }));
};

/**
 *
 * Record the served items as seen (like = 0) so they never come up again for this user.
 * No-op for anonymous users.
 *
 */
const mark_items_seen = (rows: { id: number }[], user_id: number | null): void => {
  if (user_id === null) {
    return;
  }
  const db = get_db();
  const mark_seen = db.prepare(
    `INSERT OR IGNORE INTO user_items (user_id, item_id, updated_at)
    VALUES ($user_id, $item_id, $updated_at)`
  );
  db.exec('BEGIN');
  for (const row of rows) {
    mark_seen.run({
      $user_id: user_id,
      $item_id: row.id,
      $updated_at: Math.floor(Date.now() / 1000),
    });
  }
  db.exec('COMMIT');
};

// The two-stage weighted draw. Item weight is
//   exp(AFFINITY_STRENGTH[type] · clamped_affinity) · TYPE_SHARES[type] / pool_size(type)
// and depends only on the item's (type, bucket set) group, so a per-item
// Efraimidis–Spirakis draw (take the k smallest -ln(u)/w keys — i.e. sample k
// items without replacement with probability ∝ weight) is exactly equivalent
// to: draw a group with P ∝ n_eligible·weight, take a uniform random unseen
// item from it, decrement, repeat k times. That keeps the whole request at
// O(user history + #groups) plus one cheap indexed pick per chosen group,
// instead of scanning and weighing the entire catalog.
//
// Dislikes only shrink a group's weight, never exclude it, and there is no
// deterministic ordering anywhere — with count >= pool the full pool is
// returned, just in weighted-random order.
export const get_next_feed = (count: number, user_id: number | null): FeedItem[] => {
  const groups = load_weighted_bucket_sets(user_id);
  const slots = draw_weighted_random_slots(groups, count);
  const slot_items = populate_slots(slots, user_id);

  mark_items_seen(slot_items, user_id);
  return hydrate_feed_items(slot_items, user_id);
};

export const hydrate_feed_items = (
  rows: { type: 'article' | 'picture' | 'quote'; id: number }[],
  user_id: number | null
) => {
  const rows_by_type = groupBy(rows, (r) => r.type);
  const feed_items = Object.entries(rows_by_type).flatMap<FeedItem>(([type, row]) => {
    const ids = row.map((r) => r.id);
    switch (type) {
      case 'article':
        return fetch_articles_by_ids(ids, user_id);
      case 'picture':
        return fetch_pictures_by_ids(ids, user_id);
      case 'quote':
        return fetch_quotes_by_ids(ids, user_id);
      default:
        throw new Error();
    }
  });
  const feed_items_by_id = keyBy(feed_items, (i) => i.id);

  return rows.map((row) => feed_items_by_id[row.id]);
};
