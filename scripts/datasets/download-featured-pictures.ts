import { run_download_pictures, type DiscoveredPicture } from '../lib/pictures-dataset';
import { fetch_wikitext } from '../lib/wiki';

// Parses a gallery line like:
//   File:Name.jpg|'''[[Display text]]''', by [[user:U|Name]]
// Returns { file_title, caption, credit } or null if not a File: line.
const parse_gallery_line = (
  line: string
): { file_title: string; caption: string; credit: string | null } | null => {
  const trimmed = line.trim();
  if (!trimmed.toLowerCase().startsWith('file:')) {
    return null;
  }

  const pipe_idx = trimmed.indexOf('|');
  const file_title = (pipe_idx >= 0 ? trimmed.slice(0, pipe_idx) : trimmed).trim();
  const caption_raw = pipe_idx >= 0 ? trimmed.slice(pipe_idx + 1) : '';

  // Extract the first bolded wikilink as caption: '''[[Display|Label]]''' or '''[[Display]]'''
  const caption_match = caption_raw.match(/'{2,3}\[\[([^\]|]+)(?:\|[^\]]*)?\]\]'{2,3}/);
  const caption = caption_match
    ? caption_match[1].trim()
    : file_title
        .replace(/^File:/i, '')
        .replace(/\.[^.]+$/, '')
        .replace(/_/g, ' ');

  // Extract credit: text after ", by " or "by " (handle both "by [[user:U|Name]]" and plain text)
  const credit_match = caption_raw.match(
    /[,\s]+[Bb]y\s+(?:\[\[(?:[^\]|]*\|)?([^\]]+)\]\]|([^\[,\n]+))/
  );
  const credit = credit_match ? (credit_match[1] ?? credit_match[2] ?? '').trim() || null : null;

  return { file_title, caption, credit };
};

// Fetches all subpages linked from a section of the Featured pictures index.
// Returns unique subpage names like "Wikipedia:Featured pictures/Animals/Birds".
const fetch_subpages_from_index = async (wikitext: string): Promise<Map<string, string[]>> => {
  // Map from section heading to list of subpage names
  const section_subpages = new Map<string, string[]>();
  let current_section: string | null = null;

  for (const line of wikitext.split('\n')) {
    const heading = line.match(/^={2,}\s*([^=]+?)\s*={2,}\s*$/);
    if (heading) {
      current_section = heading[1].trim();
      continue;
    }
    if (!current_section) {
      continue;
    }

    // Collect [[Wikipedia:Featured pictures/…]] links
    for (const m of line.matchAll(
      /\[\[(Wikipedia:Featured pictures\/[^\]|#]+)(?:\|[^\]]*)?\]\]/g
    )) {
      const subpage = m[1].trim();
      if (!section_subpages.has(current_section)) {
        section_subpages.set(current_section, []);
      }
      const list = section_subpages.get(current_section);
      if (list) {
        list.push(subpage);
      }
    }
  }

  return section_subpages;
};

// Parses gallery blocks out of a subpage's wikitext.
// Returns file entries found in <gallery …>…</gallery> tags.
const parse_gallery_wikitext = (
  wikitext: string
): { file_title: string; caption: string; credit: string | null }[] => {
  const results: { file_title: string; caption: string; credit: string | null }[] = [];
  // Match content inside <gallery …>…</gallery> (possibly multi-line, case-insensitive tag)
  const gallery_re = /<gallery[^>]*>([\s\S]*?)<\/gallery>/gi;
  let gm: RegExpExecArray | null;
  while ((gm = gallery_re.exec(wikitext)) !== null) {
    for (const line of gm[1].split('\n')) {
      const parsed = parse_gallery_line(line);
      if (parsed) {
        results.push(parsed);
      }
    }
  }
  return results;
};

run_download_pictures({
  filename: 'featured_pictures.db',
  title: 'Featured Pictures',
  source_url: 'https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures',
  discover: async () => {
    const index_wikitext = await fetch_wikitext('Wikipedia:Featured pictures');
    const section_subpages = await fetch_subpages_from_index(index_wikitext);

    // Deduplicate subpages while preserving their section assignment
    const subpage_to_section = new Map<string, string>();
    for (const [section, subpages] of section_subpages) {
      for (const subpage of subpages) {
        if (!subpage_to_section.has(subpage)) {
          subpage_to_section.set(subpage, section);
        }
      }
    }

    const results: DiscoveredPicture[] = [];
    const unique_subpages = [...subpage_to_section.keys()];
    process.stdout.write(
      `Found ${unique_subpages.length} gallery subpages across ${section_subpages.size} sections.\n`
    );

    for (let i = 0; i < unique_subpages.length; i++) {
      const subpage = unique_subpages[i];
      const section = subpage_to_section.get(subpage) ?? '';
      process.stdout.write(`\r  Fetching subpage ${i + 1}/${unique_subpages.length}: ${subpage}`);

      let wikitext: string;
      try {
        wikitext = await fetch_wikitext(subpage);
      } catch {
        // Some subpages may not exist; skip silently
        continue;
      }

      for (const entry of parse_gallery_wikitext(wikitext)) {
        results.push({ ...entry, topic: section });
      }
    }
    process.stdout.write('\n');

    return results;
  },
});
