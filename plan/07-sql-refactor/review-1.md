# Review 1 — SQL Refactor: Unified `feed_items` draw

**Branch:** main (commit ba49ab6 + uncommitted changes)
**Tests:** 24/24 pass (`feed`, `migrate`). `npm run check` clean.

---

## Summary

The implementation matches the plan faithfully. The three-step JS pipeline (split → per-type draw → interleave) is gone; a single Efraimidis–Spirakis query over the `feed_items` view replaces it. The math, null-safety guards, and code structure are all correct.

---

## What's good

**Division-by-zero guards are load-bearing and both are present.** `max(ps.n, 1)` prevents pool-size zero; `ratio > 0` / `ratio < 1` WHERE guards prevent zero `type_share`. The order matters (WHERE runs before ORDER BY) and it's right.

**`feed_affinity_ctes` factors the score formula correctly.** `topic_affinity_score()` is a private helper returning the `(likes + clicks - dislikes) / (exposure + smoothing)` string once. Both the article and picture CTEs call it, so the formula can't drift apart. The existing `affinity_ctes(t)` is untouched, keeping per-type tests green.

**Order preservation through Maps.** `fetch_articles_by_ids` and `fetch_pictures_by_ids` both build a `Map<id, item>` and then re-emit in the original `ids` array order via `flatMap`. `get_next_feed` reconstructs the sampled order the same way. Correct.

**`eligible_pool` is `MATERIALIZED`.** `pool_size` and the outer join both reference it; without `MATERIALIZED` SQLite could expand the CTE twice, scanning `feed_items` twice. Materialization avoids that.

**Mark-seen covers both types in one transaction.** The `BEGIN`/`COMMIT` in `get_next_feed` wraps both `mark_article` and `mark_picture` loops in a single transaction, consistent with the plan and with prior behavior.

**Migration is append-only and idempotent.** Version 4 uses `CREATE VIEW IF NOT EXISTS`, fits the runner's no-`BEGIN`/no-PRAGMA contract, and the existing test asserts a v3 → v4 upgrade path.

**Test coverage is solid:**
- Ratio boundary (0 and 1) via `jest.resetModules()` + dynamic import — non-flaky by design.
- Statistical ratio: 50 × 20 draws, 3σ band [162, 238] at r = 0.2, documented in a comment.
- Affinity-survives-unification: liked picture topic over-represented among pictures drawn.
- Fully-hydrated plain-object check (`Object.getPrototypeOf(item) === Object.prototype`).
- Migrate v4 view: existence, type coverage, and upgrade-from-v3.

---

## Issues

### Minor

**`eligible_pool` treats null `$user_id` as "user 0" for the NOT EXISTS checks.**
When `$user_id = NULL` the `WHERE ua.user_id = $user_id` inside `NOT EXISTS` is `WHERE ua.user_id = NULL`, which never matches, so every article/picture is eligible — intended behavior (null user sees everything). But the semantic is implicit; the comment says "NULL $user_id → affinity 0 everywhere" and only addresses the signal CTEs, not the eligibility branch. A reader might expect `NOT EXISTS` to accidentally pass everything through for the wrong reason. Low risk (it works correctly) but worth a one-liner comment on the null-user path in `eligible_pool`.

**The `eligible_pool` NOT EXISTS for articles checks `ua.user_id = $user_id` inside the subquery rather than in the outer join.** This is correct SQL and what the plan specifies, but it means a user who has seen an article will still have that article appear in `feed_items` (the view) — it's only filtered inside `eligible_pool`. Not a bug; just worth being aware of when reading the query cold.

**`get_next_articles_internal` still runs its own mark-seen transaction after calling `fetch_articles_by_ids`.** The mark-seen in `get_next_articles_internal` loops over `rows` (the raw id rows from the selection query), while `get_next_feed` loops over `rows` too. This is fine since `get_next_articles_internal` is a separate code path. No regression.

### Observation (not a bug)

**The affinity test's threshold (x_count > 65) is placed inside the `FEED_PICTURE_RATIO=1` describe block.** The test seeds 200 X-pictures and 200 Y-pictures, likes 20 X-pictures, then draws 100 items. At ratio = 1, 100% of draws are pictures; X's affinity boost from 20 likes should push it above the baseline ~50. The comment says "measured mean ≈ 82, sd ≈ 5; threshold > 65 is non-flaky". The threshold is plausible but the test only runs with `feed_one` (ratio = 1, 20 liked items already marked seen from the set_like call). The `set_like` helper marks seen (inserts into `user_pictures`), so the 20 liked pictures are excluded from `eligible_pool`, leaving 180 X + 200 Y = 380 eligible. That matches the inline comment. The math checks out.

---

## Verdict

**Approve.** The refactor is clean and the implementation matches the plan's math and safety requirements. The two minor observations above are cosmetic — no behavior changes needed.
