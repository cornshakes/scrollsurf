// Node-runtime-only instrumentation. Kept in a separate file that instrumentation.ts
// dynamically imports under `NEXT_RUNTIME === 'nodejs'`, so the Edge bundle never sees
// the Node APIs used here (process.on, node:sqlite, pino transports).
import { log } from './lib/log';

// Guard so Next dev HMR doesn't bind the process-level handlers more than once.
let process_handlers_registered = false;

const register_process_handlers = () => {
  if (process_handlers_registered) {
    return;
  }
  process_handlers_registered = true;
  process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    log.error({ err }, 'uncaughtException');
  });
  process.on('SIGTERM', () => {
    log.info('received SIGTERM, shutting down');
  });
};

export const start = async () => {
  register_process_handlers();

  const started = performance.now();
  log.info('startup begin');

  const { init_db } = await import('./lib/db');
  init_db();

  const {
    import_articles_dataset,
    import_pictures_dataset,
    import_quotes_dataset,
    import_categories,
    import_topic_buckets,
  } = await import('./lib/import-datasets');
  const { cleanup_inactive_users, cleanup_expired_login_codes } = await import('./lib/db');

  const datasets = ['vital_50000.db', 'unusual.db', 'good_articles.db', 'featured_articles.db'];

  for (const filename of datasets) {
    try {
      import_articles_dataset(filename);
      log.debug({ step: 'import_articles', filename }, 'dataset imported');
    } catch (err) {
      log.warn({ step: 'import_articles', filename, err }, 'dataset import failed');
    }
  }

  for (const filename of ['featured_pictures.db', 'commons_featured_pictures.db']) {
    try {
      import_pictures_dataset(filename);
      log.debug({ step: 'import_pictures', filename }, 'dataset imported');
    } catch (err) {
      log.warn({ step: 'import_pictures', filename, err }, 'dataset import failed');
    }
  }

  try {
    import_quotes_dataset('quotes.db');
    log.debug({ step: 'import_quotes', filename: 'quotes.db' }, 'dataset imported');
  } catch (err) {
    log.warn({ step: 'import_quotes', filename: 'quotes.db', err }, 'dataset import failed');
  }

  try {
    import_categories('categories.db');
    log.debug({ step: 'import_categories', filename: 'categories.db' }, 'dataset imported');
  } catch (err) {
    log.warn(
      { step: 'import_categories', filename: 'categories.db', err },
      'dataset import failed'
    );
  }

  try {
    import_categories('commons_category_hierarchy.db');
    log.debug(
      { step: 'import_categories', filename: 'commons_category_hierarchy.db' },
      'dataset imported'
    );
  } catch (err) {
    log.warn(
      { step: 'import_categories', filename: 'commons_category_hierarchy.db', err },
      'dataset import failed'
    );
  }

  try {
    import_topic_buckets('topic_buckets.db');
    log.debug({ step: 'import_topic_buckets', filename: 'topic_buckets.db' }, 'dataset imported');
  } catch (err) {
    log.warn(
      { step: 'import_topic_buckets', filename: 'topic_buckets.db', err },
      'dataset import failed'
    );
  }

  try {
    cleanup_inactive_users();
    cleanup_expired_login_codes();
    log.debug({ step: 'cleanup' }, 'cleanup complete');
  } catch (err) {
    log.warn({ step: 'cleanup', err }, 'cleanup failed');
  }

  log.info({ ms: Math.round(performance.now() - started) }, 'startup complete');
};
