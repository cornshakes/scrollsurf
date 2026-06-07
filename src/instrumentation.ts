export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  const { import_vital_articles } = await import('./lib/import-vital');
  const { import_unusual_articles } = await import('./lib/import-unusual');
  const { import_categories } = await import('./lib/import-categories');
  import_vital_articles();
  import_unusual_articles();
  import_categories();
};
