import { run_download, type DiscoveredArticle } from '../lib/dataset';
import { fetch_wikitext } from '../lib/wiki';

// Featured articles are listed on Wikipedia:Featured articles, grouped under
// ==Section== headings. The section is the article's topic.
run_download({
  filename: 'featured_articles.db',
  title: 'Featured',
  source_url: 'https://en.wikipedia.org/wiki/Wikipedia:Featured_articles',
  discover: async () => {
    const wikitext = await fetch_wikitext('Wikipedia:Featured articles');
    const results: DiscoveredArticle[] = [];
    let current_topic: string | null = null;

    for (const line of wikitext.split('\n')) {
      const heading = line.match(/^==\s*([^=]+)\s*==\s*$/);
      if (heading) {
        current_topic = heading[1].trim();
        continue;
      }
      if (!current_topic) {
        continue;
      }
      for (const m of line.matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
        const target = m[1].trim();
        if (!target || target.includes(':')) {
          continue;
        }
        results.push({ title: target.replace(/_/g, ' '), topic: current_topic });
      }
    }
    return results;
  },
});
