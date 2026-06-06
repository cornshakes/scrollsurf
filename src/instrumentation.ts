export const register = async () => {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  const { import_vital_articles } = await import('./lib/import-vital');
  import_vital_articles();
};
