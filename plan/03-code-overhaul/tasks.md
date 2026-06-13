# Code overhaul — tasks

Implementation order. Each task is self-contained; later tasks assume earlier ones
are merged. See [plan.md](plan.md) for the full rationale.

## Tasks

- [x] 1. [haiku] Add the new libraries to `package.json` and install
- [x] 2. [other] Create the shared MediaWiki API client `scripts/lib/mediawiki.ts`
- [x] 3. [sonnet] Rewrite `scripts/lib/wiki.ts` on top of the new client
- [x] 4. [sonnet] Rewrite `scripts/lib/commons.ts` on top of the new client
- [x] 5. [haiku] Replace the hand-rolled `strip_html` decoder with `entities`
- [x] 6. [haiku] Replace the four manual batch loops with `chunk` from `es-toolkit`
- [x] 7. [sonnet] Use native `Map.groupBy` for the `topic_map` / `pic_map` builds
- [x] 8. [other] Parse featured-pictures discovery with `wtf_wikipedia`
- [x] 9. [sonnet] Parse unusual-articles discovery with `wtf_wikipedia`
- [x] 10. [sonnet] Parse good-articles discovery with `wtf_wikipedia`
- [x] 11. [sonnet] Replace the manual IntersectionObserver in `RandomFeed.tsx`
- [x] 12. [sonnet] Replace the manual scroll tracking in `WikiArticles.tsx`

---

## 1. [haiku] Add the new libraries to `package.json` and install

Add to `devDependencies` (scripts-only): `ky`, `wtf_wikipedia`, `entities`, `es-toolkit`.
Add to `dependencies` (ships in client bundle): `react-intersection-observer`.

Run the package manager install so the lockfile updates. Do not pin exact versions
unless the rest of `package.json` does — match the existing `^`-range style.

No code changes in this task — only `package.json` and the lockfile.

## 2. [other] Create the shared MediaWiki API client `scripts/lib/mediawiki.ts`

Both [scripts/lib/wiki.ts](scripts/lib/wiki.ts) and
[scripts/lib/commons.ts](scripts/lib/commons.ts) carry a near-identical ~70-line block
(`sleep`, `retry_delay`, the two-attempt fetch loop). Extract a single factory that
both will consume in the next two tasks.

Export `create_mediawiki_api(api_url: string)` returning an
`async (params: URLSearchParams) => Promise<unknown>` function. Build it on `ky` and
`node:timers/promises` `setTimeout` as `sleep`. Follow the skeleton in
[plan.md](plan.md) ("One MediaWiki API client") exactly, including:

- `retry: { limit: 2, methods: ['post'], statusCodes: [429, 503], maxRetryAfter: 60_000 }`
  — POST must be listed explicitly (ky does not retry POST by default).
- An `afterResponse` hook `maxlag_as_503`: maxlag errors arrive as **HTTP 200 with an
  error body** (`data.error.code === 'maxlag'`). The hook must detect this and return a
  synthetic `503` `Response` that carries the original `Retry-After` header, so ky's
  retry machinery handles maxlag identically to a real 503. Reading the body in the hook
  consumes the stream — return a fresh `Response` so the caller can still read it on the
  non-retry path.
- Headers: real `User-Agent` (`scrollsurf/1.0 (michael.hopfner@icloud.com)`) and
  `Accept-Encoding: gzip`. Never impersonate a browser.
- `params.set('maxlag', '5')` on every request; POST the params as the body and parse
  `.json()`.
- After a successful response, `await sleep(REQUEST_DELAY_MS)` (500 ms) for serial
  API-etiquette pacing, then return the parsed data.

This preserves every CLAUDE.md API-etiquette guarantee (serial requests, 500 ms pacing,
maxlag, real User-Agent, gzip, exponential backoff on 429/503). The hand-rolled
`retry_delay` parser is gone — `Retry-After` (seconds and HTTP-date forms) is honored by
ky, capped by `maxRetryAfter`.

The factory is tagged `[other]` because the maxlag-as-synthetic-503 hook and ky's retry
semantics are subtle and easy to get subtly wrong; get this one right before the
mechanical rewrites that depend on it.

## 3. [sonnet] Rewrite `scripts/lib/wiki.ts` on top of the new client

Delete `sleep`, `retry_delay`, and the `wiki_api` fetch loop from
[scripts/lib/wiki.ts](scripts/lib/wiki.ts). Replace them with:

```ts
export const wiki_api = create_mediawiki_api('https://en.wikipedia.org/w/api.php');
```

Keep the export named `wiki_api` so existing callers don't change. Leave all the domain
helpers (`title_to_url`, `fetch_wikitext`, `fetch_category_members`,
`fetch_category_parents_batch`, `fetch_image_content`, `fetch_article_content`, and the
exported types) exactly as they are — only the transport changes.

The `data?.error?.code === 'maxlag'` handling moves into the client's hook, so it must
not remain here.

## 4. [sonnet] Rewrite `scripts/lib/commons.ts` on top of the new client

Same change as task 3 for [scripts/lib/commons.ts](scripts/lib/commons.ts):

```ts
export const commons_api = create_mediawiki_api('https://commons.wikimedia.org/w/api.php');
```

Delete `sleep`, `retry_delay`, and the `commons_api` fetch loop. Keep `commons_api`,
`commons_fetch_wikitext`, and `commons_fetch_image_content` (and their behavior). The
caller [scripts/datasets/download-commons-featured-pictures.ts](scripts/datasets/download-commons-featured-pictures.ts)
imports `commons_api` directly — verify it still type-checks against the factory's
`(params) => Promise<unknown>` signature.

Leave `strip_html` alone in this task — it is replaced separately in task 5.

## 5. [haiku] Replace the hand-rolled `strip_html` decoder with `entities`

In [scripts/lib/commons.ts](scripts/lib/commons.ts), `strip_html` currently strips tags
and then hand-decodes only 5 entities, which mangles credits containing `&nbsp;`,
numeric refs, or accented-character entities. Replace the body with:

```ts
import { decodeHTML } from 'entities';
const strip_html = (html: string): string =>
  decodeHTML(html.replace(/<[^>]*>/g, '')).trim();
```

Drop the five `.replace(/&…/g, …)` lines. Behavior elsewhere in the file is unchanged.

## 6. [haiku] Replace the four manual batch loops with `chunk` from `es-toolkit`

Replace each `for (let i = 0; i < xs.length; i += N) { const batch = xs.slice(i, i+N); … }`
loop with `for (const batch of chunk(xs, N)) { … }` using `import { chunk } from 'es-toolkit'`.
The four sites:

- [scripts/lib/dataset.ts:150](scripts/lib/dataset.ts#L150) (`to_download`, `BATCH_SIZE`)
- [scripts/lib/pictures-dataset.ts:145](scripts/lib/pictures-dataset.ts#L145) (`to_download`, `BATCH_SIZE`)
- [scripts/categorize.ts:140](scripts/categorize.ts#L140) (`nodes`, `API_TITLE_LIMIT`)
- [scripts/categorize.ts:305](scripts/categorize.ts#L305) (`unmapped`, `CHUNK_SIZE`)

Rename the loop body's index-derived variables as needed (the categorize.ts:305 site
already calls its slice `chunk`, which now collides with the import — rename the local).
Do not touch the index-counter loops at categorize.ts:207 and :237 — those iterate
`TOP_LEVELS` / `depth1` by index for logging, not batching.

## 7. [sonnet] Use native `Map.groupBy` for the `topic_map` / `pic_map` builds

In [scripts/lib/dataset.ts:107](scripts/lib/dataset.ts#L107) (`topic_map`) and
[scripts/lib/pictures-dataset.ts:101](scripts/lib/pictures-dataset.ts#L101) (`pic_map`),
the maps are built with a manual loop that creates a `Set`/object on first sight of a
key and adds to it thereafter. Replace with native `Map.groupBy` (Node ≥ 24) plus a
mapping step **only where the result reads at least as clearly as the loop**. The
`pic_map` value also carries `caption`/`credit` from the first occurrence, so it is more
involved than `topic_map`; if `Map.groupBy` does not read more clearly there, leave that
one as a loop and note why. Downstream `.get(...)` usage must keep working unchanged.

## 8. [other] Parse featured-pictures discovery with `wtf_wikipedia`

Rewrite the regex parsing in
[scripts/datasets/download-featured-pictures.ts](scripts/datasets/download-featured-pictures.ts)
using `wtf_wikipedia` (`import wtf from 'wtf_wikipedia'`). Keep the `discover` contract
and `run_download_pictures` call unchanged; only the parsing internals change.

- Index sections + subpage links: `wtf(wikitext).sections()`, using `.title()` and
  `.links()` filtered to targets under `Wikipedia:Featured pictures/…`. This replaces
  `fetch_subpages_from_index` and its `^={2,}…` / `\[\[Wikipedia:Featured pictures/…\]\]`
  regexes.
- Gallery entries: wtf's gallery/image model (`.file()`, `.caption()`), replacing
  `parse_gallery_wikitext` and `parse_gallery_line`.
- The only convention that **stays a regex** is the credit ("by [[user:U|Name]]"),
  applied to the caption text wtf returns.

This task is `[other]`: it parses live Wikipedia pages, depends on wtf's gallery model
behaving as expected, and is the discovery rewrite the plan expects to fix bugs. Verify
against the real page that section→subpage→file assignment and captions still come out
right; fall back to a narrow regex for any single rule wtf handles poorly, and note it.

## 9. [sonnet] Parse unusual-articles discovery with `wtf_wikipedia`

Rewrite [scripts/datasets/download-unusual.ts](scripts/datasets/download-unusual.ts)
with `wtf_wikipedia`, keeping `LAST_SECTION = 'Military'` and the `discover` contract.

- `{{/Section}}` transclusions (`get_section_names`): `doc.templates()` instead of the
  `\{\{\/([^}]+)\}\}` regex; still stop at and include `Military`.
- "Listed articles are bold-wrapped links" (`get_article_titles_in_section`): intersect
  each sentence's `.links()` with its `.bolds()`. Per the plan, **if that intersection
  proves unreliable on the live page, keep the existing one-line regex**
  (`/'''\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]'''/g`) for just this rule. Preserve the
  `target.includes(':')` skip (File:/Category:/etc.) and the `_`→space normalization.

## 10. [sonnet] Parse good-articles discovery with `wtf_wikipedia`

Rewrite [scripts/datasets/download-good-articles.ts](scripts/datasets/download-good-articles.ts)
with `wtf_wikipedia`, keeping the `discover` contract and both `all`/`all2` fetches.

- `{{Wikipedia:Good articles/TOPIC}}` transclusions (`get_topic_names`):
  `doc.templates()`, keeping the "topic starts with uppercase" filter.
- `{{#invoke:Good Articles|subsection|…}}` inner links (`get_articles_in_subpage`):
  **known limitation — if wtf swallows `#invoke` template contents, keep the existing
  regex** for the inner-link extraction. Verify which path applies on the live page.
  Preserve the `title.includes(':')` skip and `_`→space normalization.

## 11. [sonnet] Replace the manual IntersectionObserver in `RandomFeed.tsx`

In [src/components/RandomFeed.tsx](src/components/RandomFeed.tsx), replace the
`sentinelRef` + `IntersectionObserver` effect (which is recreated on every `isPending`
flip) with `useInView({ rootMargin: '200px' })` from `react-intersection-observer`,
plus a small effect that calls `fetchNext()` when `inView && !isPending`. Attach the
hook's `ref` to the sentinel `Box`.

The `data-testid="feed-sentinel"` is **not referenced by any e2e test**, so it can be
kept or replaced freely — preserve it unless the new structure makes that awkward.
Behavior must stay identical: first page loads on mount, subsequent pages load as the
sentinel approaches the viewport, no double-fetch while a transition is pending.

## 12. [sonnet] Replace the manual scroll tracking in `WikiArticles.tsx`

In [src/components/WikiArticles.tsx](src/components/WikiArticles.tsx), remove the
`lastScrollY` ref and the `on_scroll` handler and drive the app-bar visibility with
`useScrollTrigger` from `@mui/material` (already installed). The feed scrolls in a custom
container (the `data-testid="feed-scroll"` `Box`), **not** `window`, so:

- Hold the scroll-container node in state via a ref callback and pass it as
  `useScrollTrigger({ target: scroll_node })`.
- `showBar` becomes `!trigger`.
- The hook applies 100 px hysteresis before hiding (scroll-up reveal stays immediate);
  pass `threshold: 0` if the current instant-hide behavior is preferred — match today's
  behavior.
- **Preserve `data-testid="feed-scroll"`** — it is used by
  [e2e/helpers/pages.ts](e2e/helpers/pages.ts) to scroll the feed.

---

## Review 1 fixes

Fixes for the findings in [review-1.md](review-1.md). Ordered blockers first, then the
medium fixes, then the low-risk cleanups. Each is a small, self-contained change.

- [x] 13. [haiku] Fix `get_topic_names` crash on parameterized transclusions (Finding 6)
- [x] 14. [haiku] Restore app-bar scroll-up reveal in `WikiArticles.tsx` (Finding 1)
- [x] 15. [haiku] Fix the `maxRetryAfter` unit: `60` → `60_000` (Finding 7)
- [x] 16. [haiku] Anchor `extract_credit` on "comma-then-by" (Finding 8)
- [x] 17. [sonnet] Guard `fetch_wikitext` errors and skip bad titles in discovery (Finding 9)
- [x] 18. [haiku] Pin/guard the wtf gallery-caption internal access (Finding 3)
- [x] 19. [haiku] Fix the dangling `colon-title-bug` plan reference (Finding 5)

---

## 13. [haiku] Fix `get_topic_names` crash on parameterized transclusions (Finding 6)

**Blocker — `download-good-articles` cannot build the dataset at all.** In
[scripts/datasets/download-good-articles.ts:21](scripts/datasets/download-good-articles.ts#L21),
`get_topic_names` accepts any transclusion that starts with `{{Wikipedia:Good articles/`
and ends with `}}`, including the parameterized navbox
`{{Wikipedia:Good articles/Summary|shortcuts=…}}`. That yields the bogus topic
`"Summary|shortcuts="`, and the downstream
`fetch_wikitext('Wikipedia:Good articles/Summary|shortcuts=')` returns an
`invalidtitle` error (HTTP 200, no `parse` key) which crashes the run before any
articles are cached.

Reject parameterized transclusions — restore the old regex's semantics, which only ever
matched parameter-less names. Add a `topic.includes('|')` check to the existing guard:

```ts
const topic = raw.slice(TOPIC_PREFIX.length, -2).trim();
if (!topic || topic.includes('|') || !/^[A-Z]/.test(topic)) {
  continue;
}
```

The old path emitted 15 real topics; the new path emits those same 15 (dropping the
bogus `"Summary|shortcuts="`).

## 14. [haiku] Restore app-bar scroll-up reveal in `WikiArticles.tsx` (Finding 1)

[src/components/WikiArticles.tsx:47](src/components/WikiArticles.tsx#L47) passes
`disableHysteresis: true`, which makes `useScrollTrigger` collapse to `scrollTop > 0`:
the app bar hides on any downward scroll and only reappears when you scroll all the way
back to the top. Scrolling up mid-feed no longer reveals it — a regression vs. the
original handler (`setShowBar(y <= 0 || y < lastScrollY.current)`) and the plan's stated
"scroll-up reveal stays immediate".

Drop **only** `disableHysteresis: true`, keeping `threshold: 0`:

```ts
const trigger = useScrollTrigger({ target: scroll_node, threshold: 0 });
```

With hysteresis kept, scrolling up returns `false` (reveal), scrolling down with
`scrollTop > 0` returns `true` (instant hide), and at the top it reveals — matching
today's behavior. No e2e test exercises mid-feed scroll-up, so verify manually.

## 15. [haiku] Fix the `maxRetryAfter` unit: `60` → `60_000` (Finding 7)

[scripts/lib/mediawiki.ts:51](scripts/lib/mediawiki.ts#L51) sets `maxRetryAfter: 60`, but
ky's `maxRetryAfter` is in **milliseconds** and it *clamps* rather than cancels. A
server-requested 5 s `Retry-After` (real 429/503, or the synthetic 503 the
`maxlag_as_503` hook injects with `Retry-After: 5`) is clamped to 60 ms, so the client
retries throttling responses almost immediately instead of backing off. The plan and
[plan.md](plan.md) both specify `60_000`:

```ts
maxRetryAfter: 60_000,
```

One-token change. Update the inline comment if it still says 60.

## 16. [haiku] Anchor `extract_credit` on "comma-then-by" (Finding 8)

[scripts/datasets/download-featured-pictures.ts:36](scripts/datasets/download-featured-pictures.ts#L36)
matches `/[,\s]by\s+(.+)$/i`, which catches the **first** "by" in the caption —
including a "by" inside the picture's title (e.g. *Boy Bitten by a Lizard, by
Caravaggio* extracts `a Lizard, by Caravaggio` instead of `Caravaggio`). This corrupts
~0.5% of credits for a reproducible class of titles. Restore the original comma-then-by
anchor:

```ts
const match = caption_text.match(/,\s*by\s+(.+)$/i);
```

This fixes the title-contains-"by" cases without breaking comma-less multi-author
credits or company names that contain commas. Update the comment above it if it still
describes the looser pattern.

## 17. [sonnet] Guard `fetch_wikitext` errors and skip bad titles in discovery (Finding 9)

[scripts/lib/wiki.ts:16-17](scripts/lib/wiki.ts#L16-L17) does `data.parse.wikitext` with
no check for `data.error`, so an `invalidtitle`/`missingtitle` response (HTTP 200) throws
an opaque `TypeError` that aborts the whole run. One deleted or renamed subpage should
not take down a multi-thousand-article download.

Two parts:

- In `fetch_wikitext`, detect an error body before reading `.parse` and throw a clear,
  typed error (e.g. `throw new Error(data.error.code)`), so failures are legible.
- Wrap the `fetch_wikitext` calls in the discovery loops of
  [scripts/datasets/download-good-articles.ts:58](scripts/datasets/download-good-articles.ts#L58)
  and [scripts/datasets/download-featured-articles.ts:11](scripts/datasets/download-featured-articles.ts#L11)
  in try/catch-and-skip (log and `continue`), matching how
  [download-featured-pictures.ts:103-108](scripts/datasets/download-featured-pictures.ts#L103-L108)
  already handles missing subpages. The two top-level index fetches in
  `download-good-articles` (`/all`, `/all2`) and the single index fetch in
  `download-featured-articles` should still fail loudly — those are not "skippable".

This is `[sonnet]` because it spans three files and needs a judgment call about which
fetches are skippable vs. fatal.

## 18. [haiku] Pin/guard the wtf gallery-caption internal access (Finding 3)

[scripts/datasets/download-featured-pictures.ts:55-67](scripts/datasets/download-featured-pictures.ts#L55-L67),
`caption_title` reaches into wtf internals via an `as unknown as` cast
(`image.data.caption.bolds()`). It degrades gracefully to a filename label today, but a
wtf upgrade could silently turn every caption into a filename with no test to catch it.

Add a short comment pinning the wtf major version this internal shape was verified
against (see `wtf_wikipedia` in [package.json](package.json)), and/or a one-line
`console.warn` when `sentence?.bolds` is missing so a silent breakage surfaces in the
run log. No behavior change — this is documentation + an early-warning guard only.

## 19. [haiku] Fix the dangling `colon-title-bug` plan reference (Finding 5)

[plan.md:61](plan.md#L61) and task 8 ([tasks.md](tasks.md), the "Parse featured-pictures
discovery" section) point at `plan/colon-title-bug/plan.md`, which does not exist (only
`01-weight-random-feed`, `02-remove-dataset-selection`, and `code-overhaul` are present).
Drop the parenthetical reference in both places (or repoint it if an equivalent doc
exists). Docs-only.
