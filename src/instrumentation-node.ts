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

const do_step = (step_name: string, fn: () => void) => {
  const start = performance.now();
  fn();
  const duration = Math.round(performance.now() - start);
  log.debug(`${step_name} done (${duration}ms).`);
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
  const { cleanup_inactive_users, cleanup_expired_login_codes, rebuild_feed_index } =
    await import('./lib/db');

  for (const filename of [
    'vital_50000.db',
    'unusual.db',
    'good_articles.db',
    'featured_articles.db',
  ]) {
    do_step(`import ${filename}`, () => import_articles_dataset(filename));
  }

  for (const filename of ['featured_pictures.db', 'commons_featured_pictures.db']) {
    do_step(`import ${filename}`, () => import_pictures_dataset(filename));
  }

  do_step(`import quotes.db`, () => import_quotes_dataset('quotes.db'));

  for (const filename of ['categories.db', 'commons_category_hierarchy.db']) {
    do_step(`import ${filename}`, () => import_categories(filename));
  }

  do_step(`import topic_buckets.db`, () => import_topic_buckets('topic_buckets.db'));
  do_step('rebuild_feed_index', rebuild_feed_index);
  do_step('cleanup_inactive_users', cleanup_inactive_users);
  do_step('cleanup_expired_login_codes', cleanup_expired_login_codes);

  log.info({ ms: Math.round(performance.now() - started) }, 'startup complete');
};
