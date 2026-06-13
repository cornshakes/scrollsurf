import wtf from 'wtf_wikipedia';
import { run_download_pictures, type DiscoveredPicture } from '../lib/pictures-dataset';
import { fetch_wikitext } from '../lib/wiki';

const INDEX_PAGE = 'Wikipedia:Featured pictures';

// wtf parses the index into sections cleanly, but the per-section subpage links live in
// leading-space "» subpages: …" lines that wtf renders with empty hrefs, so the
// Wikipedia:Featured pictures/… targets are pulled with a narrow regex over each
// section's own wikitext. (This is the one index rule wtf handles poorly.)
const subpage_link_re = /\[\[(Wikipedia:Featured pictures\/[^\]|#]+)(?:\|[^\]]*)?\]\]/g;

// Maps each Featured-pictures gallery subpage to the index section that lists it.
// First section wins on duplicates, matching the previous behavior.
const discover_subpages = (index_wikitext: string): Map<string, string> => {
  const subpage_to_section = new Map<string, string>();
  for (const section of wtf(index_wikitext).sections()) {
    const heading = section.title();
    if (!heading) {
      continue;
    }
    for (const match of section.wikitext().matchAll(subpage_link_re)) {
      const subpage = match[1].trim();
      if (!subpage_to_section.has(subpage)) {
        subpage_to_section.set(subpage, heading);
      }
    }
  }
  return subpage_to_section;
};

// Photographer-credit convention ("…, by [[Author]]"): kept as a regex
// per the plan, applied to wtf's plaintext caption. Anchors on comma-then-by to avoid
// capturing "by" inside the picture's title. Drops a trailing parenthetical such as
// "(restored by …)" / "(edited by …)".
const extract_credit = (caption_text: string): string | null => {
  const match = caption_text.match(/,\s*by\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return (
    match[1]
      .replace(/\s*\(.*$/, '')
      .replace(/[)\s,]+$/, '')
      .trim() || null
  );
};

type FeaturedImage = ReturnType<ReturnType<typeof wtf>['images']>[number];

// The caption's display title is its leading bold run, which captures the
// '''[[Title]]''', '''''Title''''' and '''"Title"''' variants alike — where the old
// bold-wikilink-only regex fell back to an ugly filename. wtf's Image exposes the
// caption only as plaintext, so read the parsed caption sentence's bold text; fall back
// to a filename-derived label when a caption has no bold.
// Verified against wtf_wikipedia ^10 — accesses internal data.caption shape.
const caption_title = (image: FeaturedImage): string => {
  const sentence = (image as unknown as { data: { caption?: { bolds?: () => string[] } } }).data
    .caption;
  if (!sentence?.bolds) {
    console.warn(
      `Missing caption.bolds() at wtf version — caption_title will fall back to filename. File: ${image.file()}`
    );
  }
  const bold = (sentence?.bolds?.()[0] ?? '').replace(/'{2,}/g, '').trim();
  if (bold) {
    return bold;
  }
  return image
    .file()
    .replace(/^File:/i, '')
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ');
};

// Parses a subpage's <gallery> entries via wtf's image model. File titles are
// space-normalized so they match the titles the imageinfo API returns.
const parse_gallery = (
  wikitext: string
): { file_title: string; caption: string; credit: string | null }[] =>
  wtf(wikitext)
    .images()
    .map((image) => ({
      file_title: image.file().replace(/_/g, ' '),
      caption: caption_title(image),
      credit: extract_credit(image.caption()),
    }));

run_download_pictures({
  filename: 'featured_pictures.db',
  title: 'Featured Pictures',
  source_url: 'https://en.wikipedia.org/wiki/Wikipedia:Featured_pictures',
  discover: async () => {
    const index_wikitext = await fetch_wikitext(INDEX_PAGE);
    const subpage_to_section = discover_subpages(index_wikitext);

    const subpages = [...subpage_to_section.keys()];
    const section_count = new Set(subpage_to_section.values()).size;
    process.stdout.write(
      `Found ${subpages.length} gallery subpages across ${section_count} sections.\n`
    );

    const results: DiscoveredPicture[] = [];
    for (let i = 0; i < subpages.length; i++) {
      const subpage = subpages[i];
      const section = subpage_to_section.get(subpage) ?? '';
      process.stdout.write(`\r  Fetching subpage ${i + 1}/${subpages.length}: ${subpage}`);

      let wikitext: string;
      try {
        wikitext = await fetch_wikitext(subpage);
      } catch {
        // Some listed subpages may not exist; skip silently.
        continue;
      }

      for (const entry of parse_gallery(wikitext)) {
        results.push({ ...entry, topic: section });
      }
    }
    process.stdout.write('\n');

    return results;
  },
});
