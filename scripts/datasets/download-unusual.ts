import wtf from 'wtf_wikipedia';
import { run_download, type DiscoveredArticle } from '../lib/dataset';
import { fetch_wikitext, is_namespaced_link } from '../lib/wiki';

// Sections of Wikipedia:Unusual articles to import, in page order, up to and
// including Military. Each is transcluded as a subpage {{/<Section>}}.
const LAST_SECTION = 'Military';

// The section subpages transcluded by the main page, in order, up to and
// including LAST_SECTION. Uses doc.templates() to find {{/Section}} entries;
// wikitext() preserves original capitalisation (json().template lowercases it).
const get_section_names = (wikitext: string): string[] => {
  const doc = wtf(wikitext);
  const sections: string[] = [];
  for (const tmpl of doc.templates()) {
    const raw = tmpl.wikitext(); // e.g. "{{/History}}"
    if (!raw.startsWith('{{/') || !raw.endsWith('}}')) {
      continue;
    }
    const section = raw.slice(3, -2).trim();
    if (!section) {
      continue;
    }
    sections.push(section);
    if (section === LAST_SECTION) {
      return sections;
    }
  }
  throw new Error(`Section "${LAST_SECTION}" not found in Wikipedia:Unusual articles`);
};

// The listed articles in a section are the bold-wrapped wikilinks
// '''[[Target]]''' / '''[[Target|display]]''' in the first table column.
// Inline links inside descriptions are not bold-wrapped, so they're excluded.
// wtf's sentence.bolds() returns display text, which can differ from the page
// target, making a reliable links() ∩ bolds() intersection impossible without
// live-page verification — keeping the targeted regex per the plan's allowance.
const get_article_titles_in_section = (wikitext: string): string[] => {
  const titles: string[] = [];
  for (const m of wikitext.matchAll(/'''\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]'''/g)) {
    const target = m[1].trim();
    if (!target || is_namespaced_link(target)) {
      continue; // skip File:/Category:/etc.
    }
    titles.push(target.replace(/_/g, ' '));
  }
  return titles;
};

run_download({
  filename: 'unusual.db',
  title: 'Unusual Articles',
  source_url: 'https://en.wikipedia.org/wiki/Wikipedia:Unusual_articles',
  discover: async () => {
    const main = await fetch_wikitext('Wikipedia:Unusual articles');
    const sections = get_section_names(main);
    process.stdout.write(`${sections.length} sections (up to and including ${LAST_SECTION}).\n`);

    const results: DiscoveredArticle[] = [];
    for (const section of sections) {
      const wikitext = await fetch_wikitext(`Wikipedia:Unusual articles/${section}`);
      for (const title of get_article_titles_in_section(wikitext)) {
        results.push({ title, topic: section });
      }
      process.stdout.write(`\r${results.length} article URLs found...`);
    }
    process.stdout.write('\n');
    return results;
  },
});
