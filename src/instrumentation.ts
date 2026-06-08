export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }

  const { import_articles_dataset, import_pictures_dataset, import_categories } =
    await import('./lib/import-datasets');

  const datasets = ['vital_50000.db', 'unusual.db', 'good_articles.db', 'featured_articles.db'];

  for (const filename of datasets) {
    try {
      import_articles_dataset(filename);
    } catch (err) {
      console.warn(`[instrumentation] failed to import ${filename}:`, err);
    }
  }

  try {
    import_pictures_dataset('featured_pictures.db');
  } catch (err) {
    console.warn('[instrumentation] failed to import featured_pictures.db:', err);
  }

  try {
    import_categories();
  } catch (err) {
    console.warn('[instrumentation] failed to import categories.db:', err);
  }
};
