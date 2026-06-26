approve

## Summary

Flattens `topics: Topic[]` + `categories: string[]` into `links: Link[]`, moving chip-URL construction fully server-side. The intent matches the plan, all unit tests pass (99/99), and the 2 failing e2e tests are pre-existing (in `feed.spec.ts`, unrelated to this PR – the `items are preserved after navigating to /privacy and back` test fails in both themes).

## Check results

- `npm run check` — **passes** (type-check + lint clean)
- `npm test` — **99 passed, 0 failed**
- `npm run test:e2e` — **38 passed, 2 failed** (pre-existing: `feed.spec.ts › Home Feed › items are preserved after navigating to /privacy and back`, both light and dark; unrelated to links refactor)

## Code observations

### Minor: redundant `seen.set` inside the `if (item_seen.has(key))` branch (`links.ts:33`)

```ts
if (item_seen.has(key)) {
  seen.set(r.item_id, item_seen);  // no-op: item_seen is already in `seen` at this key
  continue;
}
```

When `item_seen.has(key)` is true, `item_seen` was obtained from `seen.get(r.item_id)` (not the fallback `new Set()`), so it's already in the map. The `seen.set` here re-assigns the same reference and can be removed — just `continue` is enough. Not a bug.

### Intentional visual change: category chip color

Old `CardTags` rendered category chips with `color="primary"` (blue-tinted); new code uses `color="default"` (gray). The plan explicitly calls for categories to be "plain `variant="outlined"`" to distinguish them from the accented dataset/topic chips. Visual snapshots in `e2e/tests/cards.spec.ts-snapshots/` were updated to reflect this. Intentional.

### `data-testid` now always present on chips (previously conditional on URL existence)

Old code: `data-testid={dataset_url ? 'link-dataset' : undefined}` (omitted when URL was null).  
New code: `data-testid={\`link-${link.type}\`}` (always set). No test relies on the old absence behavior; this is a strict improvement for testability.

### onClick tracking label for topic chips

Old code tracked `onTrack('topic', topic)` with the raw topic name. New code tracks `onTrack(link.type, link.title)` where `link.title` is `bucket` (the display label). The plan acknowledges this and the e2e click-recording test validates the behavior through chip text, so it stays green.

## Architecture

The design is clean: `fetch_links_for_items` does exactly one thing, `CardTags` is now a trivial map-over-links renderer, and `fetch_topics_for_items` is gone without residue. The `Topic` type and `topics`/`categories` fields are cleanly removed from the public types; `BaseFeedItem.links` carries the full client-side contract.
