# Review 1

All 75 tests pass (`npm test`). No issues found. The implementation matches the plan exactly.

## Correctness

**`NAMESPACE_RE`** — The regex is correct and well-scoped. It anchors at `^` and terminates at `:`, so a mainspace title like `"Batman: Arkham City"` or `"9:05"` will never match. The `/i` flag handles case variants. The `(?:[ _]talk)?[ _]*` optional group covers Wikipedia's compound talk-namespaces (`Wikipedia talk:`, `Wikipedia_talk:`) and any stray whitespace/underscore before the colon.

One small observation: the regex also accepts `"File  :Foo.jpg"` (multiple spaces before the colon) as namespaced, and the tests verify this explicitly. Wikipedia itself does not normalise multi-space namespace prefixes this way, so this is an over-match. However, real wikitext never contains such titles, so it is harmless in practice.

**`Media:` vs `MediaWiki:`** — the regex lists `Media` before `MediaWiki`. Because the alternation is non-greedy and `|` tries left-to-right, `Media:` would match a `MediaWiki:` prefix and stop at `Media`, leaving `Wiki:` unmatched — but since the overall pattern requires the `:` to appear immediately after `[ _]*`, a `MediaWiki:` string will match the `MediaWiki` branch if the engine backtracks. Actually, with `|` in a non-capturing group `(?:...|...)`, the engine tries `Media` first: `Media` matches `Media` in `MediaWiki`, then `(?:[ _]talk)?[ _]*` matches nothing, then the pattern expects `:` but finds `W` — so it backtracks and tries `MediaWiki`, which matches correctly. This is safe.

**Three parsers** — each imports `is_namespaced_link` from `../lib/wiki` and applies it correctly. The surrounding `if (!target || …) { continue; }` structure is unchanged. All three files had the identical bug; all three are fixed.

**Tests** — comprehensive. Covers all named namespaces, case-insensitivity, underscore and whitespace variants, talk namespaces, edge cases (empty string, no-colon prefix, multiple colons in a title). The `jest.mock` at the top is necessary because `scripts/lib/wiki.ts` calls `create_mediawiki_api` at module scope; without it the test file would fail to import. This is the correct approach.

## Minor notes (no action needed)

- The `tests/__mocks__/` directory appears in `git status` as untracked. It does not affect the tests — they pass without it — but if it contains a manual mock intended to replace the `jest.mock(...)` call inside the test, it should be reviewed for completeness. (No concern here since the inline mock is sufficient and correct.)
- The plan cited line 37 in `download-good-articles.ts` and line 42 in `download-unusual.ts`; the actual changes land at lines 37 and 42 respectively — accurate.
- `NAMESPACE_RE` is `const` (module-level, not exported), which is correct: callers only need `is_namespaced_link`.

## Summary

Clean, minimal, and correct. The regex is well-chosen and the fix is applied uniformly across all affected parsers. Tests are thorough. No regressions.
