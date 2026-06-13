import wtf from 'wtf_wikipedia';
import { run_download, type DiscoveredArticle } from '../lib/dataset';
import { fetch_wikitext } from '../lib/wiki';

const TOPIC_PREFIX = '{{Wikipedia:Good articles/';

// Good articles are organized into topic subpages transcluded from
// Wikipedia:Good_articles/all and Wikipedia:Good_articles/all2.
// doc.templates() replaces the transclusion regex; wikitext() preserves original
// capitalisation (json().template lowercases it). Only topics starting with an
// uppercase letter are real sections.
const get_topic_names = (wikitext: string): string[] => {
  const doc = wtf(wikitext);
  const topics: string[] = [];
  for (const tmpl of doc.templates()) {
    const raw = tmpl.wikitext();
    if (!raw.startsWith(TOPIC_PREFIX) || !raw.endsWith('}}')) {
      continue;
    }
    const topic = raw.slice(TOPIC_PREFIX.length, -2).trim();
    if (!topic || topic.includes('|') || !/^[A-Z]/.test(topic)) {
      continue;
    }
    topics.push(topic);
  }
  return topics;
};

// Each topic subpage lists articles inside {{#invoke:Good Articles|subsection|...}} blocks.
// wtf swallows #invoke template contents — doc.links() returns empty inside them —
// so the inner-link extraction keeps its regex per the plan's known-limitation allowance.
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
      let wikitext: string;
      try {
        wikitext = await fetch_wikitext(`Wikipedia:Good articles/${topic}`);
      } catch (err) {
        process.stdout.write(
          `\nSkipping topic "${topic}": ${err instanceof Error ? err.message : err}\n`
        );
        continue;
      }
      results.push(...get_articles_in_subpage(wikitext, topic));
      process.stdout.write(`\r${results.length} articles found...`);
    }
    process.stdout.write('\n');
    return results;
  },
});
