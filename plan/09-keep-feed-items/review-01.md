approve

# Review: Keep Feed Items Across View Changes

## Checks

| Check | Result |
|---|---|
| `npm run check` (tsc + eslint) | ✅ Pass |
| `npm test` (Jest, 95 tests) | ✅ Pass |
| `npm run test:e2e` (Playwright, 20 tests) | ✅ Pass — all 3 new keep-feed tests pass |

## Summary

The implementation is correct and complete. The approach matches the plan: lift feed items into a context provider at the root layout level, save scroll position via a ref, restore via `useLayoutEffect`. All four cases (view switch, privacy navigation) are covered by the e2e spec and verified passing.

## Observations

### Minor naming inconsistency

The plan and tasks both specify `scroll_top_ref` (snake_case, consistent with CLAUDE.md and the rest of the file). The implementation uses `scrollTopRef` everywhere instead. Within `WikiArticles.tsx` this creates a mixed-case inconsistency: the local `scroll_nodeRef` uses snake_case prefix but the imported `scrollTopRef` uses camelCase.

Not a correctness issue, and the code is otherwise clean — but worth aligning with the convention if this is touched again.

### Initial-fetch effect deps differ from the plan

The plan specified `}, [])` (empty deps array), but the implementation uses `}, [items.length, fetchNext])`. In practice this is equivalent (items never reset to 0 once populated, and fetchNext is stable), and the chosen form satisfies ESLint's exhaustive-deps rule without suppression. A fine deviation.

### `useMemo` on context value

`useMemo` is used to avoid re-rendering all consumers on every `FeedProvider` render. The deps `[items]` are correct (setItems and scrollTopRef are stable references). This is a sensible optimization consistent with the size of the consumer tree.

### e2e spec quality

The three tests cover the two distinct unmount cases described in the plan. The scroll-position test uses `toBeGreaterThan(0)` rather than an exact match, which is intentional and avoids sub-pixel flakiness. The privacy navigation test correctly uses the menu link for the outbound SPA navigation and `page.goBack()` for the return — both work correctly under App Router's layout caching.
