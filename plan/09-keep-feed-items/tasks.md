# Tasks: Keep feed items across view changes

## TOC

- [x] Create `FeedContext.tsx` [sonnet]
- [x] Wire `FeedProvider` into `App.tsx` [haiku]
- [x] Consume feed context in `RandomFeed.tsx` [haiku]
- [x] Save and restore scroll position in `WikiArticles.tsx` [sonnet]
- [x] Add e2e spec for feed persistence [sonnet]

---

## 1. Create `FeedContext.tsx`

**File:** `src/components/FeedContext.tsx` (new)

Create a `'use client'` module that mirrors the structure of `CookieConsent.tsx`.

- Define `FeedContextValue` with:
  - `items: FeedItem[]`
  - `setItems: React.Dispatch<React.SetStateAction<FeedItem[]>>`
  - `scroll_top_ref: React.RefObject<number>`
- `FeedProvider` holds `useState<FeedItem[]>([])` and `useRef<number>(0)`, provides them via context.
- `useFeed()` reads the context and throws if called outside the provider.

Import `FeedItem` from `@/lib/db`.

---

## 2. Wire `FeedProvider` into `App.tsx`

**File:** `src/components/App.tsx`

Inside the existing `ConsentProvider`, wrap `{children}` with `<FeedProvider>`. No other changes.

---

## 3. Consume feed context in `RandomFeed.tsx`

**File:** `src/components/RandomFeed.tsx`

- Replace the local `useState<FeedItem[]>([])` with `const { items, setItems } = useFeed()`.
- Keep `isPending`, `useTransition`, and `useInView` as local state — they are transient.
- Change the initial-fetch `useEffect` to guard on `items.length === 0`:

  ```ts
  useEffect(() => {
    if (items.length === 0) {
      fetchNext();
    }
  }, []);
  ```

  The deduplication logic inside `fetchNext` and the infinite-scroll effect are unchanged.

---

## 4. Save and restore scroll position in `WikiArticles.tsx`

**File:** `src/components/WikiArticles.tsx`

- Call `useFeed()` to get `scroll_top_ref`.
- **Save:** add `onScroll` on the `feed-scroll` Box:
  ```ts
  onScroll={(event) => {
    if (view === 'random') {
      scroll_top_ref.current = event.currentTarget.scrollTop;
    }
  }}
  ```
- **Restore:** add a `useLayoutEffect` that runs when `view` or `scroll_node` changes. When `view === 'random'` and `scroll_node` is set, assign `scroll_node.scrollTop = scroll_top_ref.current`.

Use `useLayoutEffect` (not `useEffect`) so the scroll is applied after items render but before paint, preventing a visible jump.

---

## 5. Add e2e spec for feed persistence

**File:** `e2e/tests/keep-feed.spec.ts` (new)

Use the helpers from `e2e/helpers/pages.ts` (`switch_view`, `feed-card`, `feed-scroll`, `scroll_to_load_all`).

Write four assertions:

1. Load `/`, capture the first card title from `feed-card`.
2. `switch_view` to `'liked'` then back to `'random'`; assert the same first card title is still present (no re-fetch).
3. Scroll the `feed-scroll` container, record `scrollTop`, switch away and back, assert `scrollTop` is restored.
4. Navigate to `/privacy` via the menu link and return to `/`; assert items and `scrollTop` are preserved (covers the App Router route-navigation case).

If any visual snapshots shift after adding this spec, update them with `npm run test:e2e:update`.
