# Review 1: Disapprove

## Checks run

- `npm run check` — **passed** (no TypeScript errors, no lint errors)
- `npm test` — **passed** (109 tests, 10 suites)
- `npm run test:e2e` — **1 failure** (see below)

---

## Overall quality

The implementation is clean and closely mirrors the existing patterns for articles and pictures. The architecture is well-structured:

- `Quote` type, migration 6, `quotes.ts`, `import_quotes_dataset`, `QuoteCard`, and tests all follow the established patterns.
- `FEED_TYPE_SHARES` generalization is done correctly at module-load time, interpolated into SQL (consistent with `AFFINITY_STRENGTH`/`AFFINITY_CLAMP`).
- The switch-based dispatch in `feed.ts` is clean.
- `entities` library is used correctly for HTML entity decoding in the download script.
- The resumable month-granularity download is well designed.

---

## Findings

### Blocking: E2e scroll-position test regresses

**File:** `e2e/tests/feed.spec.ts:37`

```
Error: expect(received).toBeLessThanOrEqual(expected)
Expected: <= 301
Received:    462
```

`Home Feed › preserves items and scroll position when switching views and back` sets `scrollTop = 300`, switches views (liked → random), then asserts the scroll position is restored to ~300. The received value is 462.

`feed.spec.ts` was not modified by this PR. The regression is caused indirectly: adding quote cards to the e2e fixture changes the feed composition (quote cards are shorter than article/picture cards — no image, just text). When switching views and back, browser scroll anchoring adjusts `scrollTop` upward to compensate for height differences in the re-rendered cards, landing at 462 instead of the preserved 300.

This is not pre-existing — the quote seeding in `global-setup.ts` is new in this PR, and all other e2e tests pass.

The fix would be to either:
1. Add `overflow-anchor: none` to the feed scroll container (disables scroll anchoring), or
2. Add a short `waitFor` / forced scroll restore after the view switch to ensure the scroll position is applied after the DOM settles.

---

### Non-blocking observations

**`e2e/global-setup.ts` — conditional quote re-seeding logic is forward-compat but potentially surprising**

```ts
} else {
  const quote_count = db.prepare('select 1 from quotes limit 1').get();
  if (!quote_count) {
    seed_quotes(db);
  }
}
```

This handles the case where an existing e2e DB from before migration 6 already has items but no quotes. It's correct for that upgrade path. However, the pattern also means resetting just the quotes table manually (without `test:e2e:reset-db`) would trigger re-seeding but not re-seeding articles/pictures. Acceptable in context.

**`import_quotes_dataset` — item_topics insertion scope**

The plan says "for newly inserted items" but the implementation inserts topics for all `quote` items that lack a `Quotes` topic. This is actually more correct for idempotency (handles the case where an item was somehow inserted without a topic) and consistent with how the `INSERT OR IGNORE` pattern works throughout. ✓

**`get_voted_quotes` signature accepts `user_id: number | null`**

`actions.ts` only calls it after a null-guard, so passing null never happens in practice. Accepting null is harmless and consistent with `fetch_quotes_by_ids`. ✓

**`scroll_to_load_all` hard-codes 14 cards**

```ts
await expect(page.getByTestId('feed-card')).toHaveCount(14);
```

The fixture has exactly 14 items (8 articles + 4 pictures + 2 quotes), so this passes. If the fixture grows, this number needs updating. Not a bug but worth noting.
