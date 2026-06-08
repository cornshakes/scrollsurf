import { run_download, type DiscoveredArticle } from '../lib/dataset';
import { fetch_wikitext } from '../lib/wiki';

// Good articles are organized into topic subpages transcluded from
// Wikipedia:Good_articles/all and Wikipedia:Good_articles/all2.
// Parse {{Wikipedia:Good articles/TOPIC}} transclusions to get topic names.
const get_topic_names = (wikitext: string): string[] =>
  [...wikitext.matchAll(/\{\{Wikipedia:Good articles\/([^|}#\n]+)\}\}/g)]
    .map((m) => m[1].trim())
    .filter((name) => /^[A-Z]/.test(name)); // actual topics start with uppercase

// Each topic subpage lists articles inside {{#invoke:Good Articles|subsection|...}} blocks.
const get_articles_in_subpage = (wikitext: string, topic: string): DiscoveredArticle[] => {
  const results: DiscoveredArticle[] = [];
  for (const m of wikitext.matchAll(/\{\{#invoke:Good Articles\|subsection\|([\s\S]*?)\}\}/g)) {
    for (const link of m[1].matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) {
      const title = link[1].trim();
      if (!title || title.includes(':')) {
        continue;
      }
      results.push({ title: title.replace(/_/g, ' '), topic });
    }
  }
  return results;
};

run_download({
  filename: 'good_articles.db',
  title: 'Good Articles',
  source_url: 'https://en.wikipedia.org/wiki/Wikipedia:Good_articles',
  discover: async () => {
    const all1 = await fetch_wikitext('Wikipedia:Good articles/all');
    const all2 = await fetch_wikitext('Wikipedia:Good articles/all2');
    const topics = [...get_topic_names(all1), ...get_topic_names(all2)];
    process.stdout.write(`${topics.length} topics found.\n`);

    const results: DiscoveredArticle[] = [];
    for (const topic of topics) {
      const wikitext = await fetch_wikitext(`Wikipedia:Good articles/${topic}`);
      results.push(...get_articles_in_subpage(wikitext, topic));
      process.stdout.write(`\r${results.length} articles found...`);
    }
    process.stdout.write('\n');
    return results;
  },
});
