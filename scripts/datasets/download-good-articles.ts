import { run_download } from '../lib/dataset';
import { fetch_category_members } from '../lib/wiki';

// Good articles are the members of Category:Good articles (namespace 0). The
// page itself groups them by topic via templates, not wikilinks, so the API
// gives us no usable sub-topics — these articles carry only the dataset label.
run_download({
  filename: 'good_articles.db',
  title: 'Good',
  source_url: 'https://en.wikipedia.org/wiki/Wikipedia:Good_articles',
  discover: async () => {
    const titles = await fetch_category_members('Category:Good articles', { namespace: 0 }, (n) =>
      process.stdout.write(`\r${n} articles found...`)
    );
    process.stdout.write('\n');
    return titles.map((title) => ({ title }));
  },
});
