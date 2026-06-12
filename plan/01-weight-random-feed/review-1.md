# Review 1 — Topic-Affinity Weighted Feed

## Overall

Implementation is clean and faithful to the plan. All 11 tasks are marked done, the core math is correct, and the test coverage matches the spec. Three findings below: one stale doc, one robustness nit, one structural observation.

---

## Findings

### 1. Stale sentence in CLAUDE.md (minor doc gap)

[CLAUDE.md:87](../../CLAUDE.md#L87) still reads:

> Each type has its own `ORDER BY RANDOM()` query; there is no SQL UNION.

The feed selection section (lines 109+) was correctly rewritten, but this earlier sentence in the "Pictures vs articles" table section wasn't touched. It should say "weighted-random query" (or similar) to match the new reality.

**Fix:** update the sentence, e.g. `Each type has its own weighted-random query; there is no SQL UNION.`

---

### 2. No validation of `FEED_AFFINITY_STRENGTH` env var (robustness nit)

[src/lib/db/affinity.ts:7-10](../../src/lib/db/affinity.ts#L7-L10):

```ts
export const AFFINITY_STRENGTH =
  process.env.FEED_AFFINITY_STRENGTH !== undefined
    ? parseFloat(process.env.FEED_AFFINITY_STRENGTH)
    : 2.0;
```

`parseFloat("off")` returns `NaN`. `NaN` is then baked into `WEIGHTED_RANDOM_ORDER_BY` as a literal via template substitution, producing `exp(NaN * …) = NaN` and `… / NaN = NaN` in every ORDER BY expression. SQLite sorts NULLs first in ASC order (the comment on line 48 already calls this out as a footgun for the random-to-(0,1] mapping), so NaN-producing expressions could corrupt the draw silently.

The fix is one line — add a `|| 2.0` fallback or an `isNaN` guard:

```ts
const parsed = parseFloat(process.env.FEED_AFFINITY_STRENGTH ?? '');
export const AFFINITY_STRENGTH = isNaN(parsed) ? 2.0 : parsed;
```

This matches the resilience pattern used for `FEED_PICTURE_RATIO`.

---

### 3. `afterEach` WAL checkpoint swallows errors silently (observation)

[tests/lib/db/affinity.test.ts:18-22](../../tests/lib/db/affinity.test.ts#L18-L22):

```ts
afterEach(() => {
  try {
    get_db().exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {}
});
```

The WAL checkpoint is a sensible addition for large statistical tests. The empty `catch {}` means a real DB error (e.g. a lock that should have been released) would be silently swallowed. Since `reset_db` runs next, failures there will surface eventually — but the root cause becomes harder to diagnose. Not a blocker, but worth noting.

---

## What's correct

- **`affinity.ts`** — constants, CTE chain, and `WEIGHTED_RANDOM_ORDER_BY` all match the plan exactly. The `max(..., 1e-12)` guard protecting `ln(0)` is present and load-bearing.
- **`articles.ts` / `pictures.ts`** — the three changes (prefix, LEFT JOIN, ORDER BY replacement) are correctly applied; all other statements are untouched.
- **`affinity.test.ts`** — all 7 test cases are present with the correct statistical thresholds and deterministic sub-checks. The anonymous-user double-fetch (`r1` / `r2` both length 10) correctly verifies no mark-seen side-effect.
- **CLAUDE.md** — feed selection section and feature-flags table are correct.
- **`.env.example`** — updated correctly with the commented-out knob.
- Cross-user isolation (test 6) uses ±15 bounds on a σ≈5 distribution — non-flaky.
