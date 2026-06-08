import { run_download, type DiscoveredArticle } from '../lib/dataset';
import { fetch_category_members } from '../lib/wiki';

const LIMIT = parseInt(process.env.DOWNLOAD_LIMIT ?? '') || Infinity;

// Wikipedia's Level 5 vital articles, grouped into 11 sublists. Each sublist is
// a quality-tracking category over Talk pages, so we list namespace 1 and strip
// the 'Talk:' prefix to get the article title. The sublist is the topic.
const VITAL_TOPICS = [
  'People',
  'History',
  'Geography',
  'Arts',
  'Philosophy and religion',
  'Everyday life',
  'Biology and health sciences',
  'Physical sciences',
  'Mathematics',
  'Technology',
  'Society and social sciences',
];

run_download({
  filename: 'vital_50000.db',
  title: 'Vital',
  source_url: 'https://en.wikipedia.org/wiki/Wikipedia:Vital_articles/Level_5',
  discover: async () => {
    const results: DiscoveredArticle[] = [];
    for (const topic of VITAL_TOPICS) {
      const members = await fetch_category_members(
        `Category:Wikipedia level-5 vital articles in ${topic}`,
        { namespace: 1 }
      );
      for (const title of members) {
        results.push({ title: title.replace(/^Talk:/, ''), topic });
        if (results.length >= LIMIT) {
          process.stdout.write('\n');
          return results;
        }
      }
      process.stdout.write(`\r${results.length} article URLs found...`);
    }
    process.stdout.write('\n');
    return results;
  },
});
