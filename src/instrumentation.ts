export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  const { import_vital_articles } = await import('./lib/import-vital');
  const { import_unusual_articles } = await import('./lib/import-unusual');
  const { import_good_articles } = await import('./lib/import-good-articles');
  const { import_featured_articles } = await import('./lib/import-featured-articles');
  const { import_categories } = await import('./lib/import-categories');
  import_vital_articles();
  import_unusual_articles();
  import_good_articles();
  import_featured_articles();
  import_categories();
};
