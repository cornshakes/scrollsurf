# Review 2: Approve

## Checks run

- `npm run check` — **passed** (no TypeScript errors, no lint errors)
- `npm test` — **passed** (109 tests, 10 suites)
- `npm run test:e2e` — **passed** (20 tests, including the new quote-card screenshot and the scroll-position test)

---

## R1-1 Fix: Scroll-position regression

The fix was applied at `src/components/WikiArticles.tsx:136` — `overflowAnchor: 'none'` on the `data-testid="feed-scroll"` container. This is the correct element (the actual scrollable container), even though review-1 suggested `RandomFeed.tsx` as the target. The result is confirmed: the `Home Feed › preserves items and scroll position when switching views and back` e2e test now passes.

---

## Overall quality

The implementation is solid. No new issues to flag.

- The `eligible_pool` CTE in `affinity.ts` is type-agnostic — it queries `items` directly — so quotes slot in without any changes to the affinity/ranking path.
- `import_quotes_dataset` hardcodes `'Quotes'` rather than interpolating from the dataset name (unlike the articles/pictures importers which escape and interpolate). This is strictly safer — no risk of SQL injection from a dataset title — and consistent with the fixed-topic design.
- The conditional quote re-seeding in `e2e/global-setup.ts` (lines 217–222) correctly handles an existing fixture DB that predates migration 6.
- The `scroll_to_load_all` hard-coding of 14 cards (noted in review-1 as minor) is still there and still correct for the current fixture size.
