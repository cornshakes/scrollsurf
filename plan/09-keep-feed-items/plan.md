# Plan: Keep the random feed's items (and scroll position) across view changes

## Context

The random feed currently loses all its loaded items whenever the user leaves it
and comes back — switching to Liked / Disliked / Categories, or navigating to the
Privacy page and back. Each return re-fetches a fresh batch from scratch, which is
jarring (the user loses their place and sees different content) and wastes server
work.

The cause is that the feed's state lives in component-local `useState` inside
[RandomFeed.tsx](../../src/components/RandomFeed.tsx#L16), and that component is
unmounted in two situations:

1. **View switching** — [WikiArticles.tsx:134](../../src/components/WikiArticles.tsx#L134)
   conditionally renders `<RandomFeed />` only when `view === 'random'`, so picking
   another view unmounts it and drops its `items` state.
2. **Privacy navigation** — `/privacy` is a separate App Router route
   ([privacy/page.tsx](../../src/app/privacy/page.tsx)) reached via `NextLink`, so the
   entire `WikiArticles` subtree unmounts.

**Desired end state:** the random feed keeps its loaded items and restores the exact
scroll offset when the user returns from any of those places. Only the random feed is
affected — Liked/Disliked feeds should still reflect fresh vote state and are left
as-is.

## Approach

Lift the random feed's state into a React context whose provider lives in the
persistent root layout. App Router preserves layouts across route navigation, and a
provider above the view conditional survives view switches — so the same provider
covers **both** unmount cases. This matches the existing pattern of cross-cutting
client state (`ConsentProvider` in [App.tsx](../../src/components/App.tsx)).

Plain React context is the right tool here (no new dependency): the state is small,
client-only, and the user already suggested it.

### 1. New `FeedContext` (new file `src/components/FeedContext.tsx`)

A `'use client'` module exporting `FeedProvider` and a `useFeed()` hook, mirroring the
structure of [CookieConsent.tsx](../../src/components/CookieConsent.tsx).

State held by the provider:

- `items: FeedItem[]` + `setItems` — the loaded random-feed items (moved out of
  `RandomFeed`). Import `FeedItem` from `@/lib/db`.
- `scroll_top_ref: RefObject<number>` — a `useRef(0)` storing the last scroll offset
  of the random feed. A ref (not state) so scroll updates never trigger re-renders.

`useFeed()` throws if used outside the provider (same guard style as `useConsent`).

### 2. Wire the provider into the layout — [App.tsx](../../src/components/App.tsx)

Wrap `children` with `<FeedProvider>` inside the existing `ConsentProvider`. Because
`App` is rendered by the root layout, the provider persists across the `/` ↔
`/privacy` navigation as well as across in-page view switches.

### 3. `RandomFeed` consumes the context — [RandomFeed.tsx](../../src/components/RandomFeed.tsx)

- Replace the local `useState<FeedItem[]>([])` with `const { items, setItems } = useFeed();`.
- Keep `isPending`/`useTransition` and `useInView` local — they are transient and
  per-mount.
- Change the initial-fetch effect to only fetch when nothing is cached yet:

  ```ts
  useEffect(() => {
    if (items.length === 0) {
      fetchNext();
    }
  }, []);
  ```

  The dedupe logic in `fetchNext` and the infinite-scroll effect are unchanged.

### 4. Save & restore scroll position — [WikiArticles.tsx](../../src/components/WikiArticles.tsx)

The scroll container is the `feed-scroll` Box in `WikiArticles`, which already has a
node handle via `set_scroll_node`. Use the `scroll_top_ref` from `useFeed()`:

- **Save:** add an `onScroll` handler on the `feed-scroll` Box that writes
  `scroll_top_ref.current = event.currentTarget.scrollTop` while `view === 'random'`.
- **Restore:** a `useLayoutEffect` keyed on `[view, scroll_node]` that, when
  `view === 'random'` and the node exists, sets `scroll_node.scrollTop =
  scroll_top_ref.current`. `useLayoutEffect` runs after the cached items have
  rendered (so the scroll height already exists) but before paint, avoiding a visible
  jump. Card images use fixed-dimension `next/image`, so layout height is stable on
  remount.

This restores position both for in-page view switches (container persists) and for
return-from-privacy (container remounts).

## Files

- **New:** `src/components/FeedContext.tsx` — `FeedProvider`, `useFeed`,
  `FeedContextValue`.
- **Edit:** [src/components/App.tsx](../../src/components/App.tsx) — wrap with
  `FeedProvider`.
- **Edit:** [src/components/RandomFeed.tsx](../../src/components/RandomFeed.tsx) —
  read `items`/`setItems` from context; fetch only when empty.
- **Edit:** [src/components/WikiArticles.tsx](../../src/components/WikiArticles.tsx) —
  `onScroll` save + `useLayoutEffect` restore of scroll offset.

No DB, server-action, or schema changes.

## Testing & verification

### E2e (Playwright) — primary coverage

Add a spec (e.g. `e2e/tests/keep-feed.spec.ts`, or extend
`likes-clicks.spec.ts`) using existing helpers in
[e2e/helpers/pages.ts](../../e2e/helpers/pages.ts) (`switch_view`, `feed-card`,
`feed-scroll`, `scroll_to_load_all`):

1. Load `/`, capture the first card's title (and ideally the full ordered list of
   loaded titles).
2. `switch_view(page, 'liked')` then `switch_view(page, 'random')`; assert the same
   titles are still present in the same order (proves no re-fetch).
3. Scroll the `feed-scroll` container down, record `scrollTop`, switch away and back,
   assert `scrollTop` is restored.
4. Navigate to `/privacy` via the menu link and back to `/`; assert items and
   scroll offset are preserved (this is the route-navigation case the layout-level
   provider must cover).

Run with `npm run test:e2e`. If any visual snapshots shift, review and update with
`npm run test:e2e:update`.

### Unit (Jest)

No new unit tests required — coverage is scoped to `src/lib` and `src/app/actions.ts`
(component state isn't unit-tested today).

### Checks

- `npm run check` (type-check + lint), then `npm run lint-fix`.
- `npm test` to confirm existing unit tests still pass.
- Manual smoke (`npm run dev`): load feed, scroll a few screens, switch to Liked and
  back, then visit Privacy and back — items and scroll position should be unchanged
  each time.
