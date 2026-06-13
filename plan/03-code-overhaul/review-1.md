# Review 1 — Code overhaul (replace hand-rolled utilities with libraries)

Reviewer: Claude (Opus 4.8). Scope: the `code-overhaul` working tree + the three
related commits (`17b9e36`, `137d5c9`, `059964c`). No previous review files existed.

## What I checked

- Read [plan.md](plan.md) and [tasks.md](tasks.md) (all 12 tasks marked done).
- Read every changed file: `mediawiki.ts` (new), `wiki.ts`, `commons.ts`,
  `dataset.ts`, `pictures-dataset.ts`, the three `download-*` discovery scripts,
  `categorize.ts`, `RandomFeed.tsx`, `WikiArticles.tsx`, `package.json`.
- Cross-checked the React changes against the original via `git diff`, and the
  pictures rewrite against `git show HEAD:…download-featured-pictures.ts`.
- Verified library behavior in `node_modules`: MUI `useScrollTrigger.js` and
  wtf_wikipedia gallery parsing (`02-section/start-to-end/gallery.js`,
  `Document.images()`).
- **Ran:** `npm run check` (tsc + eslint) → clean, exit 0. `npx jest` → 45/45 pass.
- **Did not run:** `npm run test:e2e` (needs a built app, running server, and the
  e2e fixture DB) and the live-API smoke download (hits Wikipedia). Their gaps are
  called out below.

Overall: the library swaps are clean and the new MediaWiki client is well done.
There is **one behavior regression** (app-bar reveal) that should be fixed before
merge, plus a verification gap around the three wtf discovery rewrites.

---

## Findings

### 1. [HIGH] `disableHysteresis: true` breaks scroll-up reveal of the app bar

[WikiArticles.tsx:47](../../src/components/WikiArticles.tsx#L47):

```ts
const trigger = useScrollTrigger({ target: scroll_node, threshold: 0, disableHysteresis: true });
```

MUI's `defaultTrigger` (`node_modules/@mui/material/useScrollTrigger/useScrollTrigger.js`):

```js
if (!disableHysteresis && previous !== undefined) {
  if (store.current < previous) { return false; }   // scrolling up → reveal
}
return store.current > threshold;
```

With `disableHysteresis: true` the direction-comparison is skipped, so the trigger
collapses to `scrollTop > 0`. Net effect: **the bar hides on any downward scroll and
only reappears when you scroll all the way back to `scrollTop === 0`.** Scrolling up
mid-feed no longer reveals it.

The original handler revealed on every upward scroll:

```ts
setShowBar(y <= 0 || y < lastScrollY.current);   // y < last ⇒ reveal mid-feed
```

This contradicts the plan's own intent ("scroll-up reveal stays immediate") and its
UI verification criterion ("app bar … reappears on scroll-up"), and it violates the
overhaul's stated goal that "the app's behavior stays the same."

The fix is to keep hysteresis and only zero the threshold — `threshold: 0` **without**
`disableHysteresis`. That reproduces today's behavior exactly: scroll-up → `return false`
→ reveal; scroll-down with `scrollTop > 0` → `return true` → instant hide; at top → reveal.

Not caught by tests: the e2e menu helpers (`open_menu` → `scroll_feed_to_top`) always
scroll to the top before asserting, so the regressed bar is visible there; no test
exercises mid-feed scroll-up.

### 2. [MEDIUM] The three wtf discovery rewrites are effectively unverified

Tasks 8–10 are the highest-risk changes (they parse live Wikipedia pages) and have
**no automated coverage**. The plan's only smoke test —
`DOWNLOAD_LIMIT=30 npm run download-vital-50000` — exercises the *vital* path, which
uses neither wtf nor any of the rewritten scripts. So pictures/unusual/good discovery
ships unvalidated. Two concrete behavior differences I found by diffing against the
original featured-pictures parser:

- **Caption source changed.** Original took the bolded wikilink *target*
  (`'''[[Target|Label]]'''` → `Target`). New `caption_title`
  ([download-featured-pictures.ts:55](../../scripts/datasets/download-featured-pictures.ts#L55))
  reads `sentence.bolds()[0]`, i.e. wtf's rendered *display text* (`Label`). For
  non-wikilink bolds (`'''''Title'''''`, `'''"Title"'''`) this is the intended
  improvement; for piped wikilinks it's a silent semantic change, and `'''"Title"'''`
  keeps its surrounding quotes (the `.replace(/'{2,}/g, '')` strips apostrophes, not `"`).

- **Credit extraction is looser.** Original anchored at `, by` and captured the
  wikilink display or text up to the next comma/bracket. New `extract_credit`
  ([download-featured-pictures.ts:35](../../scripts/datasets/download-featured-pictures.ts#L35))
  matches `/[,\s]by\s+(.+)$/i` — everything to end of caption — and only trims a trailing
  parenthetical. A caption like `…, by Jane Doe, restored by Bob` now yields
  `Jane Doe, restored by Bob` where the original yielded `Jane Doe`.

Neither is necessarily wrong (the plan explicitly tags task 8 `[other]` and asks for
live-page verification), but nothing in the repo proves the output is still correct.
Recommend a real `download-featured-pictures` / `download-unusual` /
`download-good-articles` run against live Wikipedia, spot-checking captions, credits,
and section→file assignment, before treating these as done.

### 3. [LOW] `caption_title` depends on wtf internals via an `as unknown as` cast

[download-featured-pictures.ts:56-58](../../scripts/datasets/download-featured-pictures.ts#L56)
reaches into `image.data.caption.bolds()`. I confirmed this matches wtf's gallery model
(`gallery.js` stores `img.caption = parseSentence(...)`, a `Sentence` exposing `.bolds()`),
and it degrades gracefully to a filename label if the shape ever changes — so it won't
crash. But it's an undocumented internal coupled by a hand-written cast; a wtf upgrade
could silently turn every caption into a filename with no test to catch it. Worth a
short comment pinning the wtf major version, or a guard/log if `bolds` is missing.

### 4. [LOW] One overhaul commit doesn't build in isolation

`137d5c9` ("Replace hand-rolled strip_html…") rewrites `commons.ts` to
`import { create_mediawiki_api } from './mediawiki'`, but `scripts/lib/mediawiki.ts` is
still **untracked** — tasks 2/3/4 are marked done in tasks.md yet aren't committed.
So that commit (and the tree between it and now) won't type-check on a clean checkout,
which breaks `git bisect`. Not a problem for the final state, but the working tree should
be committed as one coherent unit (mediawiki.ts + wiki.ts + commons.ts together).

### 5. [NIT] Dangling plan reference

[plan.md:61](plan.md#L61) and task 8 point at `plan/colon-title-bug/plan.md`, which
doesn't exist (only `01-weight-random-feed`, `02-remove-dataset-selection`,
`code-overhaul` are present). Drop or fix the reference.

---

## What's good (verified correct)

- **`mediawiki.ts`** is the strongest part. `maxlag_as_503` correctly clones the
  response before reading the body (original stream survives the non-retry path),
  returns a synthetic 503 carrying the original `Retry-After`, and only acts on
  `response.ok`. `retry` lists `'post'` explicitly (ky skips POST by default), caps
  `maxRetryAfter`, and 429/503 match the old set. Serial 500 ms pacing, real
  User-Agent, gzip, and `maxlag=5` per request are all preserved — every CLAUDE.md
  etiquette guarantee holds. `wiki.ts`/`commons.ts` collapsed to domain helpers with
  no leftover `sleep`/`retry_delay`, and `download-commons-featured-pictures.ts` still
  type-checks against the `(params) => Promise<unknown>` signature.
- **`strip_html`** via `decodeHTML` is correct and strictly better than the 5-entity table.
- **`chunk`** replacements are right at all four sites; the `categorize.ts:305` local was
  renamed (`batch_cats`) to avoid colliding with the import, and the index-counter loops
  at `:207`/`:237` were correctly left alone.
- **`Map.groupBy`** for `topic_map`/`pic_map`: groupBy preserves source order, so
  `items[0].caption/credit` still means "first occurrence" — first-wins-on-duplicate
  semantics are preserved. Downstream `.get(...)` usage is unchanged.
- **`RandomFeed.tsx`**: `useInView` keeps the same viewport root (the original observer
  also used `root: null`) and `rootMargin: '200px'`. The mount-fetch + `inView && !isPending`
  effect preserves first-page-on-mount and pending-guarded chaining; no new double-fetch
  path. `data-testid="feed-sentinel"` preserved.
- `package.json` placement matches the plan: `react-intersection-observer` in
  `dependencies`; `ky`/`wtf_wikipedia`/`entities`/`es-toolkit` in `devDependencies`,
  all `^`-ranged.

## Recommendation

Fix **#1** (drop `disableHysteresis: true`) before merge — it's a one-token change that
restores the intended behavior. Address **#2** by actually running the three discovery
downloads against live Wikipedia and spot-checking output; that's the only way to close
the verification gap, since the existing tests can't. #3–#5 are cleanups that can ride
along or follow.

---

# Review Addition — after running all six download scripts against live Wikipedia

Reviewer: Claude (Opus 4.8). This is the live-API verification that Review 1 #2 said
was missing. Each script was run against a **scratch `datasets/` dir** (the repo's real
DBs are backed up as `*.old.db`, so nothing was touched). `DOWNLOAD_LIMIT` only gates
*vital*; the other five have no item cap, so each was run until discovery completed plus
the first phase-2 batch(es), then stopped, and the resulting `discovered_*` / content
tables were inspected.

Re-ran `npm run check` (tsc + eslint) → clean. `npx jest` → 45/45 pass.

## Smoke-run results

| Script | Discovery | Phase 2 | Verdict |
|---|---|---|---|
| download-vital-50000 (`DOWNLOAD_LIMIT=5`) | 5 titles | 5 articles, extracts + images + 280 category rows | ✅ full end-to-end |
| download-unusual (wtf) | 13 sections incl. Military, 4014 unique | 2600+ downloaded clean | ✅ |
| download-featured-articles | 6833 articles | downloading clean (new ky transport) | ✅ |
| download-commons-featured-pictures | 222 subpages enumerated; `commons_api` + `strip_html`/`entities` verified | n/a (stopped in discovery) | ✅ transport + strip_html |
| download-good-articles (wtf) | **crashes** | — | ❌ **blocker (Finding 6)** |
| download-featured-pictures (wtf) | 86 subpages / 19 sections, 8760 pics | downloading; captions good | ⚠️ credit bug (Finding 8) |

## Findings

### 6. [HIGH — blocker] `download-good-articles` crashes in discovery (wtf rewrite regression)

`npm run download-good-articles` dies immediately in Phase 1:

```
TypeError: Cannot read properties of undefined (reading 'wikitext')
    at fetch_wikitext (scripts/lib/wiki.ts:17)
    at discover (scripts/datasets/download-good-articles.ts:58)
```

Root cause is the task-10 rewrite of `get_topic_names`
([download-good-articles.ts:12-27](../../scripts/datasets/download-good-articles.ts#L12-L27)).
It takes each template's full `tmpl.wikitext()`, checks `startsWith('{{Wikipedia:Good articles/')`
and `endsWith('}}')`, then `raw.slice(TOPIC_PREFIX.length, -2)`. The index page contains a
**parameterized** navbox transclusion `{{Wikipedia:Good articles/Summary|shortcuts=…}}`,
so the slice yields the topic `"Summary|shortcuts="`. The downstream
`fetch_wikitext('Wikipedia:Good articles/Summary|shortcuts=')` gets
`{"error":{"code":"invalidtitle"}}` (HTTP 200, no `parse` key) and crashes.

The **old regex** `/\{\{Wikipedia:Good articles\/([^|}#\n]+)\}\}/g` required `}}`
*immediately* after the name, so it only ever matched parameter-less transclusions and
never produced this bad title. Reproduced directly — the new path emits 16 topics, 15
real + `"Summary|shortcuts="`; the old path emits the 15 real ones.

Because the crash happens *before* `discovered_articles` is cached, every run fails the
same way — **the good-articles dataset cannot be built at all** in the current state.

Fix: reject parameterized transclusions, restoring the old semantics, e.g.

```ts
const topic = raw.slice(TOPIC_PREFIX.length, -2).trim();
if (!topic || topic.includes('|') || !/^[A-Z]/.test(topic)) {
  continue;
}
```

This is precisely the verification gap Review 1 #2 called out — it shipped broken.

### 7. [MEDIUM] `maxRetryAfter: 60` is 1000× too small (plan said `60_000`)

[mediawiki.ts:51](../../scripts/lib/mediawiki.ts#L51) sets `maxRetryAfter: 60`, but
plan.md and tasks.md both specify `60_000`. ky's `maxRetryAfter` is in **milliseconds**,
and this build *clamps* rather than cancels:
`node_modules/ky/distribution/core/Ky.js:279-281` → `return after < max ? after : max`.
So when Wikipedia returns a `Retry-After` (real 429/503, or the synthetic 503 the
`maxlag_as_503` hook injects carrying `Retry-After: 5`), the requested 5000 ms backoff is
clamped to **60 ms**. The client therefore retries throttling responses almost
immediately instead of honoring the server's requested delay — the opposite of the
"back off with exponential delay on 429/503" etiquette guarantee the whole client exists
to provide. Bounded by `limit: 2`, so impact is a short burst rather than a hang, and it
only fires under throttling — but it's a clear plan deviation and the fix is one token:
`maxRetryAfter: 60_000`.

Note: Review 1's "What's good" section praised "caps `maxRetryAfter`" without catching the
unit error.

### 8. [MEDIUM] `extract_credit` over-captures when the picture title contains "by"

[download-featured-pictures.ts:35](../../scripts/datasets/download-featured-pictures.ts#L35)
uses `/[,\s]by\s+(.+)$/i`, which matches the **first** "by" in the caption — including a
"by" inside the *title*. Confirmed against the live page:

| caption (title) | extracted credit | should be |
|---|---|---|
| Boy Bitten **by** a Lizard | `a Lizard, by Caravaggio` | Caravaggio |
| Castle **by** the River | `the River, at and by Karl Friedrich Schinkel` | Karl Friedrich Schinkel |
| Religion saved **by** Spain | `Spain, by Titian` | Titian |
| Virgin and Child Surrounded **by** Angels | `Angels at Melun Diptych, by Jean Fouquet` | Jean Fouquet |

Scope: **41 of 8669** credits (~0.5%) end up with a "`…, by …`" fragment baked in. Not a
crash, but corrupt display data for a reproducible class of titles. The original anchored
on `, by` (comma-then-by); restoring that anchor fixes it without affecting the legit
cases (comma-less multi-author credits like `Léon Sabatier after …` and company names
with commas like `Leggett, Keatinge & Ball` both still come out right):

```ts
const match = caption_text.match(/,\s*by\s+(.+)$/i);
```

The rest of the featured-pictures output is correct: 19 sensible sections, captions
extracted cleanly (0 filename fallbacks across 8760 pics, so the bold-run logic works),
and quoted titles like `"The Queen of Hearts"` are genuine quotes, not artifacts.

### 9. [LOW] `fetch_wikitext` has no error guard; callers crash on any bad/missing page

[wiki.ts:8-18](../../scripts/lib/wiki.ts#L8-L18) does `data.parse.wikitext` with no check
for `data.error`, so an `invalidtitle`/`missingtitle` response (HTTP 200) throws an opaque
`TypeError`. This is **pre-existing** (the old transport had the same gap) and was only
unmasked by Finding 6 — but it's why a single bad title takes down the whole run.
`download-featured-pictures` wraps `fetch_wikitext` in try/catch; `download-good-articles`
([:58](../../scripts/datasets/download-good-articles.ts#L58)) and
`download-featured-articles` do not. Worth either a guard in `fetch_wikitext` that throws
a clear `Error(data.error.code)` or try/catch-and-skip at the discovery call sites, so one
deleted/renamed subpage can't abort a multi-thousand-article download.

## Status of Review 1 findings

- **#1 (`disableHysteresis: true`)** — still present at
  [WikiArticles.tsx:47](../../src/components/WikiArticles.tsx#L47). **Not fixed.**
- **#2 (wtf rewrites unverified)** — now verified by these runs: unusual ✅,
  featured-pictures ✅ except Finding 8, good-articles ❌ (Finding 6).
- **#3–#5** — unchanged (not re-examined here).

## Recommendation (updated)

Two blockers before merge: **Finding 6** (good-articles is completely broken) and
Review 1 **#1** (app-bar reveal). **Finding 7** (`maxRetryAfter`) and **Finding 8**
(credit over-capture) are small, high-confidence fixes worth taking in the same pass.
Finding 9 is a robustness hardening that can follow.
