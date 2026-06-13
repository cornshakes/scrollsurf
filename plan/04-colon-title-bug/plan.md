# Fix colon-title filtering in dataset discovery parsers

## Context

110 of 90,790 runtime articles have no topic rows, which means the feed never serves them (both feed queries require `EXISTS (… topics …)`). Root cause: all three wikitext-parsing discovery scripts skip any link target containing a colon:

```ts
if (!target || target.includes(':')) { continue; }
```

The intent is to skip namespace links (`File:`, `Category:`, `Wikipedia:`), but it also drops legitimate mainspace titles like "Batman: Arkham City" or "Star Trek: First Contact".

Measured impact:
- **Featured articles page**: 112 colon-containing link targets — 111 are real articles, only 1 is a `Category:` link.
- **Good articles**: the Video games subpage alone lists **421** colon-titled articles, none namespaced; `good_articles.db` contains zero colon-titled articles.
- **Unusual**: sampled section had no colon-titled bold links; low impact but same latent bug.
- **vital_50000** uses the category-members API (no wikitext parsing) — unaffected. Pictures pipelines want `File:` titles — unaffected.

Per user direction: **no backfill machinery**. Datasets are download-once artifacts — fix the parser, and incomplete reference DBs get deleted and redownloaded from scratch by the user.

## Changes

### 1. Shared namespace check — `scripts/lib/wiki.ts`

Add an exported helper (const arrow, snake_case, per code style):

```ts
// Mainspace titles may contain colons ("Star Trek: First Contact"); only skip
// links into a real namespace (File:, Category:, Wikipedia:, ...).
const NAMESPACE_RE =
  /^(?:Talk|User|Wikipedia|Project|WP|File|Image|Media|MediaWiki|Template|Help|Category|CAT|Portal|Draft|TimedText|Module|Special)(?:[ _]talk)?[ _]*:/i;
export const is_namespaced_link = (target: string): boolean => NAMESPACE_RE.test(target);
```

### 2. Use it in the three parsers

Replace `target.includes(':')` / `title.includes(':')` with `is_namespaced_link(...)` in:
- [scripts/datasets/download-featured-articles.ts:26](scripts/datasets/download-featured-articles.ts#L26)
- [scripts/datasets/download-good-articles.ts:37](scripts/datasets/download-good-articles.ts#L37)
- [scripts/datasets/download-unusual.ts:42](scripts/datasets/download-unusual.ts#L42)

### 3. Unit test

Add `tests/lib/wiki.test.ts` (jest, alongside existing `tests/` suites) covering `is_namespaced_link`: namespaced (`File:Foo.jpg`, `Category:Bar`, `Wikipedia talk:X`, case-insensitive `file:foo`) vs mainspace colon titles (`Batman: Arkham City`, `Star Trek: First Contact`, `9:05`).

No changes to `scripts/lib/dataset.ts`, no re-discovery flags, no backfill SQL.

## Data repair (user-driven)

Delete the affected reference DBs and redownload once with the fixed parser:
`datasets/featured_articles.db`, `datasets/good_articles.db`, `datasets/unusual.db` → `npm run download-featured-articles`, `download-good-articles`, `download-unusual`.

The runtime DB then heals itself on next app startup: `import_articles_dataset` joins ref topic rows to existing `main.articles` by URL with `INSERT OR IGNORE`, so the previously topic-less articles gain topic rows without any extra code.

## Verification

- `npm test` — new wiki test plus existing suite.
- Type-check passes, then `npm run lint-fix` (per CLAUDE.md).
- After the user redownloads and starts the app once:
  - `sqlite3 scrollsurf.db "SELECT COUNT(*) FROM articles a WHERE NOT EXISTS (SELECT 1 FROM article_topics t WHERE t.article_id = a.id)"` → 0 (currently 110).
  - Spot-check: "Batman: Arkham City" has topic rows with dataset = Featured.
