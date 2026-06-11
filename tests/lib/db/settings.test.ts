import {
  setup,
  reset,
  cleanup,
  get_test_db,
  insert_user,
  insert_article,
  insert_dataset,
} from '../../helpers/test-db';
import { set_dataset_enabled, get_datasets_enabled } from '@/lib/db/settings';
import { get_next_articles_internal } from '@/lib/db/articles';

beforeAll(() => {
  setup();
});

beforeEach(() => {
  reset();
});

afterAll(() => {
  cleanup();
});

describe('set_dataset_enabled and get_datasets_enabled', () => {
  test('round-trip: set enabled=false, read back false', () => {
    const user_id = insert_user();
    insert_dataset('vital');

    set_dataset_enabled('vital', false, user_id);

    const result = get_datasets_enabled(user_id);
    expect(result['vital']).toBe(false);
  });

  test('default enabled=true when no row exists for a dataset', () => {
    insert_user();
    insert_dataset('vital');
    insert_dataset('unusual');

    const result = get_datasets_enabled(null);
    expect(result['vital']).toBe(true);
    expect(result['unusual']).toBe(true);
  });

  test('disabled dataset is excluded from get_next_articles results', () => {
    const user_id = insert_user();
    insert_dataset('vital');
    insert_dataset('unusual');

    const article_id = insert_article();
    const db = get_test_db();
    db.prepare(
      'INSERT INTO article_topics (article_id, dataset, topic) VALUES ($id, $dataset, $topic)'
    ).run({
      $id: article_id,
      $dataset: 'vital',
      $topic: 'History',
    });

    // Before disabling: article should be returned
    let articles = get_next_articles_internal(10, user_id);
    expect(articles.length).toBe(1);

    // Disable vital dataset
    set_dataset_enabled('vital', false, user_id);

    // After disabling: article should not be returned
    articles = get_next_articles_internal(10, user_id);
    expect(articles.length).toBe(0);
  });
});
