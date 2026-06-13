# Fix colon-title filtering — tasks

Implementation order. Each task is self-contained; later tasks assume earlier ones
are done. See [plan.md](plan.md) for the full rationale.

## Tasks

- [x] 1. [haiku] Add `is_namespaced_link` helper to `scripts/lib/wiki.ts`
- [x] 2. [haiku] Replace `target.includes(':')` with `is_namespaced_link` in the three parsers
- [x] 3. [haiku] Write unit tests for `is_namespaced_link` in `tests/lib/wiki.test.ts`

---

## 1. [haiku] Add `is_namespaced_link` helper to `scripts/lib/wiki.ts`

Add an exported const arrow function to [scripts/lib/wiki.ts](scripts/lib/wiki.ts):

```ts
const NAMESPACE_RE =
  /^(?:Talk|User|Wikipedia|Project|WP|File|Image|Media|MediaWiki|Template|Help|Category|CAT|Portal|Draft|TimedText|Module|Special)(?:[ _]talk)?[ _]*:/i;
export const is_namespaced_link = (target: string): boolean => NAMESPACE_RE.test(target);
```

Place it near the top of the file, before the domain helpers. The comment on the
first line explains the non-obvious reason: mainspace titles may contain colons.

## 2. [haiku] Replace `target.includes(':')` with `is_namespaced_link` in the three parsers

In each file, import `is_namespaced_link` from `../lib/wiki` and replace the colon
guard:

- [scripts/datasets/download-featured-articles.ts:26](scripts/datasets/download-featured-articles.ts#L26) — `target.includes(':')`
- [scripts/datasets/download-good-articles.ts:37](scripts/datasets/download-good-articles.ts#L37) — `title.includes(':')`
- [scripts/datasets/download-unusual.ts:42](scripts/datasets/download-unusual.ts#L42) — `target.includes(':')`

Change the guard from `target.includes(':')` to `is_namespaced_link(target)` (resp.
`title`). The surrounding `if (!target || …) { continue; }` shape stays unchanged.

## 3. [haiku] Write unit tests for `is_namespaced_link` in `tests/lib/wiki.test.ts`

Add `tests/lib/wiki.test.ts` (jest, alongside existing `tests/` suites):

Namespaced (must return `true`): `File:Foo.jpg`, `Category:Bar`, `Wikipedia:Foo`,
`Wikipedia talk:X`, `file:foo` (case-insensitive), `WP:Foo`, `Image:X.png`,
`Template:Infobox`, `Help:Contents`, `Portal:Science`, `Module:Foo`, `Special:Search`.

Mainspace colon titles (must return `false`): `Batman: Arkham City`,
`Star Trek: First Contact`, `9:05`, `Halo: Combat Evolved`.
