import { get_db } from './connection';

// Rebuilds the derived feed-index tables from item_topics + topic_buckets.
// A "bucket set" is an item's combination of buckets; items sharing the same
// combination share a set_id (feed weight only depends on (type, set_id)).
export const rebuild_feed_index = (): void => {
  const db = get_db();
  db.exec('BEGIN');
  try {
    db.exec(`
      DELETE FROM bucket_set_items;
      DELETE FROM bucket_set_buckets;
      DELETE FROM bucket_set_counts;
    `);

    // map each item to a bucket set depending on its topic_buckets
    create_bucket_sets();
    // map all the topic_buckets back to their bucket sets
    map_buckets_to_sets();
    // pre-calculate/index the item counts
    calculate_item_counts();

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

const create_bucket_sets = () => {
  // item_buckets — each item's topic_buckets;
  //   | item_id | bucket          |
  //   | 42      | Vital ∥ History |
  //   | 42      | Unusual ∥ Places|
  //
  // item_set_keys — buckets sorted and joined into one key per item
  //   | item_id | set_key                           |
  //   | 42      | Unusual ∥ Places ␞ Vital ∥ History|
  //
  // set_keys — one set_id per distinct key
  //   | set_key                            | set_id |
  //   | Unusual ∥ Places ␞ Vital ∥ History | 7      |
  //
  // bucket_set_items — every item tagged with its set_id.
  // If there are any items that are not properly mapped to topic/topic_bucket/bucket_set,
  // this will throw, because the left join will lead to null set_ids getting inserted in a not null column
  //   | item_id | type    | set_id |
  //   | 42      | article | 7      |
  get_db().exec(`
      WITH item_buckets AS (
        SELECT DISTINCT it.item_id, tb.bucket
        FROM item_topics it
        JOIN topic_buckets tb ON tb.dataset = it.dataset AND tb.topic = it.topic
      ),
      item_set_keys AS (
        SELECT item_id, group_concat(bucket, char(30) ORDER BY bucket) AS set_key
        FROM item_buckets
        GROUP BY item_id
      ),
      set_keys AS (
        SELECT set_key, ROW_NUMBER() OVER (ORDER BY set_key) AS set_id
        FROM (SELECT DISTINCT set_key FROM item_set_keys)
      )
      INSERT INTO bucket_set_items (item_id, type, set_id)
      SELECT i.id, i.type, s.set_id
      FROM items i
      LEFT JOIN item_set_keys k ON k.item_id = i.id
      LEFT JOIN set_keys s ON s.set_key = k.set_key;
    `);
};

const map_buckets_to_sets = () => {
  // representatives — one arbitrary member item per set (all members have
  // identical buckets, so any one recovers the set's bucket list)
  //   | set_id | item_id |
  //   | 7      | 42      |
  //
  // bucket_set_buckets — the set expanded back into its buckets
  //   | set_id | bucket          |
  //   | 7      | Vital ∥ History |
  //   | 7      | Unusual ∥ Places|
  get_db().exec(`
      WITH representatives AS (
        SELECT set_id, MIN(item_id) AS item_id
        FROM bucket_set_items
        GROUP BY set_id
      )
      INSERT INTO bucket_set_buckets (set_id, bucket)
      SELECT r.set_id, tb.bucket
      FROM representatives r
      JOIN item_topics it ON it.item_id = r.item_id
      JOIN topic_buckets tb ON tb.dataset = it.dataset AND tb.topic = it.topic
      GROUP BY r.set_id, tb.bucket;
    `);
};

const calculate_item_counts = () => {
  // bucket_set_counts — pool size per (type, set)
  //   | type    | set_id | item_count |
  //   | article | 7      | 120        |
  get_db().exec(`
      INSERT INTO bucket_set_counts (type, set_id, item_count)
      SELECT type, set_id, COUNT(*)
      FROM bucket_set_items
      GROUP BY type, set_id;
    `);
};
