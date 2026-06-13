# Code overhaul: replace hand-rolled utilities with mature libraries

## Goal

Remove hand-written infrastructure code that reimplements well-solved problems — HTTP retry/backoff, wikitext parsing, HTML entity decoding, array chunking, scroll/viewport observation — and replace it with a small set of popular, mature libraries. The app's behavior stays the same; the code that remains is the project-specific logic only.

## Libraries (end state of package.json)

| Library | Replaces | Placement |
|---|---|---|
| `ky` | hand-rolled fetch + retry loops in `scripts/lib/wiki.ts` and `scripts/lib/commons.ts` | devDependency (scripts only) |
| `wtf_wikipedia` | regex-based wikitext parsing in the three discovery scripts | devDependency (scripts only) |
| `entities` | hand-rolled 5-entity HTML decoder in `scripts/lib/commons.ts` | devDependency (scripts only) |
| `es-toolkit` | manual `for (i += N) slice(i, i + N)` batch loops (4 sites) | devDependency (scripts only) |
| `react-intersection-observer` | manual IntersectionObserver lifecycle in `RandomFeed.tsx` | dependency (client bundle) |
| `@mui/material` `useScrollTrigger` | manual scroll-direction tracking in `WikiArticles.tsx` | already installed |

Node built-ins also adopted: `node:timers/promises` `setTimeout` (deletes two hand-rolled `sleep` helpers), `Map.groupBy` where it reads at least as clearly as the manual grouping loops (Node ≥ 24 everywhere per Dockerfile).

## End state

### One MediaWiki API client (`scripts/lib/mediawiki.ts`)

`wiki.ts` and `commons.ts` currently each carry a near-identical ~70-line block: `sleep`, a `Retry-After` parser, and a two-attempt fetch loop handling connection errors, 429/503, and maxlag. End state: a single factory both files use.

```ts
import ky from 'ky';
import { setTimeout as sleep } from 'node:timers/promises';

export const create_mediawiki_api = (api_url: string) => {
  const client = ky.create({
    headers: { 'User-Agent': 'scrollsurf/1.0 (michael.hopfner@icloud.com)', 'Accept-Encoding': 'gzip' },
    retry: { limit: 2, methods: ['post'], statusCodes: [429, 503], maxRetryAfter: 60_000 },
    hooks: { afterResponse: [maxlag_as_503] },
  });
  return async (params: URLSearchParams): Promise<unknown> => {
    params.set('maxlag', '5');
    const data = await client.post(api_url, { body: params }).json();
    await sleep(REQUEST_DELAY_MS); // API-etiquette serial pacing
    return data;
  };
};
```

Design points:

- **Retry-After is honored by the library** for 429/503 (both seconds and HTTP-date forms) — the hand-rolled parser is deleted. `maxRetryAfter` caps the wait so a pathological header can't hang a script.
- **maxlag** arrives as HTTP 200 with an error body; the `afterResponse` hook (`maxlag_as_503`) detects it and returns a synthetic 503 carrying the original `Retry-After` header, so ky's retry machinery handles it identically.
- POST is explicitly listed in `retry.methods` (ky does not retry POST by default).
- All API-etiquette guarantees from CLAUDE.md are preserved: serial requests with 500 ms pacing, `maxlag` on every request, real User-Agent, gzip.
- `wiki.ts` and `commons.ts` shrink to their domain helpers (`fetch_wikitext`, `fetch_category_members`, `fetch_article_content`, `commons_fetch_image_content`, …) on top of `create_mediawiki_api('https://en.wikipedia.org/w/api.php')` / (`…commons.wikimedia.org…`).

### Wikitext parsing via wtf_wikipedia

The discovery scripts keep only the conventions that are genuinely page-specific; structural parsing moves to `wtf_wikipedia`:

- `download-featured-pictures.ts`: index sections + subpage links come from `wtf(wikitext).sections()` (`.title()`, `.links()` filtered to `Wikipedia:Featured pictures/…`); `<gallery>` entries come from wtf's gallery/image model (`.file()`, `.caption()`). Only the credit convention ("by [[user:U|Name]]") remains a small regex over the caption text.
- `download-unusual.ts`: `{{/Section}}` transclusions via `doc.templates()`; the "listed articles are bold-wrapped links" rule via intersecting sentence `.links()` with `.bolds()`. If that intersection proves unreliable on the live page, this one rule keeps its existing one-line regex.
- `download-good-articles.ts`: `{{Wikipedia:Good articles/TOPIC}}` transclusions via `doc.templates()`. The `{{#invoke:Good Articles|subsection|…}}` inner-link extraction keeps its regex if wtf swallows `#invoke` contents (known limitation to verify).

The new `discover()` is expected to fix some bugs.

### Small utility replacements

- `scripts/lib/commons.ts` `strip_html`: `decodeHTML(html.replace(/<[^>]*>/g, '')).trim()` using `entities` — fixes credits containing `&nbsp;`, numeric refs, or accented-character entities that the 5-entity table decodes wrong today.
- Batch loops in `scripts/lib/dataset.ts`, `scripts/lib/pictures-dataset.ts`, `scripts/categorize.ts` (×2): `for (const batch of chunk(items, N))` from `es-toolkit`.
- The `topic_map` / `pic_map` builds in dataset.ts / pictures-dataset.ts use native `Map.groupBy` + a mapping step, applied only where it reads at least as clearly as the loop.

### React components

- `RandomFeed.tsx`: the manual IntersectionObserver effect (recreated on every `isPending` flip) becomes `useInView({ rootMargin: '200px' })` plus a small effect on `inView && !isPending`. `data-testid="feed-sentinel"` is replaced with something else if necessary / e2e tests can be adapted.
- `WikiArticles.tsx`: `lastScrollY` ref + `on_scroll` handler are replaced by `useScrollTrigger({ target: scroll_node })`, with the scroll container node held in state via a ref callback (the feed scrolls in a custom container, not `window`). `showBar` becomes `!trigger`. Note: the hook applies a 100 px hysteresis before hiding (scroll-up reveal stays immediate); pass `threshold: 0` if instant hide is preferred. `data-testid="feed-scroll"` is preserved.

## Out of scope (considered, rejected)

- `zx` for `scripts/deploy.ts` and `js-cookie` for the single cookie read in `CookieConsent.tsx` — working code too small to justify the dependency.
- Any change to the feed-selection SQL, affinity weighting, or DB layer (CLAUDE.md constraints; no ORM).

## Testing & verification (end state)

- **Smoke:** `DOWNLOAD_LIMIT=30 npm run download-vital-50000` against a scratch `datasets/` dir confirms client + chunking end-to-end, with the 500 ms serial pacing visible in timing.
- **UI:** `npm run test:e2e` (testids preserved); manually, infinite scroll loads pages and the app bar hides on scroll-down / reappears on scroll-up.
- **Conventions:** snake_case, const arrow functions, braces always; `npm run check` then `npm run lint-fix`.
