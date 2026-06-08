export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const imports = [
    { name: 'vital', module: './lib/datasets/import-vital', fn: 'import_vital_articles' },
    { name: 'unusual', module: './lib/datasets/import-unusual', fn: 'import_unusual_articles' },
    { name: 'good', module: './lib/datasets/import-good-articles', fn: 'import_good_articles' },
    {
      name: 'featured',
      module: './lib/datasets/import-featured-articles',
      fn: 'import_featured_articles',
    },
    { name: 'categories', module: './lib/datasets/import-categories', fn: 'import_categories' },
  ];

  for (const imp of imports) {
    try {
      const mod = await import(imp.module);
      if (mod[imp.fn]) {
        mod[imp.fn]();
      }
    } catch {
      // Skip missing datasets
    }
  }
};
