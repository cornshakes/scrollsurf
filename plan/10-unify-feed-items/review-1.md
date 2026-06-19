approve

# Review: Unify feed items under a global-id supertype

## Checks run

- `npm run check` — pass (type-check + lint, no errors)
- `npm test` — 96 tests, 9 suites, all pass
- `npm run test:e2e` — 19 tests, all pass

## Code review

### Migration (migrations.ts v5)
Correct append-only migration. The URL-bridge approach for migrating data from per-type IDs to global IDs is sound:
- Orphan clicks deleted _before_ `UPDATE user_clicks` (correct order — would be a silent data loss bug otherwise)
- `foreign_keys = OFF` is already managed by the runner, so drop order is unconstrained
- Both article and picture INSERTs into `items` fail loudly on UNIQUE conflict if URLs collide (deliberate integrity guard, as noted in the plan)
- Legacy prod DB path is well-tested: the "converge legacy v0 DB" test covers the pre-caption, pre-`user_articles` scenario and verifies the migrated picture survives

### affinity.ts
Clean collapse to a single arm. The `clicked` CTE correctly drops `item_type` filtering since global IDs prevent cross-type collisions. `eligible_pool` using `items` directly is much simpler than the old `UNION ALL`. `NULL $user_id` still reduces to uniform random via the same `NOT EXISTS` + empty `user_items` path — strict generalization preserved.

### feed.ts
Mark-seen is now a single `INSERT OR IGNORE INTO user_items` — no per-type branch. The `like DEFAULT 0` on `user_items` means "seen but not voted" is correctly represented. The `type_share` CASE expression is kept as a product knob for the article/picture ratio. Payload fetch still dispatches by `.type` to `fetch_articles_by_ids`/`fetch_pictures_by_ids`.

### articles.ts / pictures.ts
Correctly join `items i JOIN articles a ON a.item_id = i.id LEFT JOIN user_items ui …`. `row_to_article`/`row_to_picture` mappers are unchanged in shape (same output columns; `id` is now the global id). `get_voted_*` first fetches IDs then calls `fetch_*_by_ids` — two round trips per call, but this matches the prior pattern and is not a correctness issue.

### topics.ts
`fetch_topics_by_item` simplified to a single `item_topics` query with no `(table, col)` branching. Category-tree queries correctly use `item_categories`, `items i … WHERE i.type = 'article'`, and `user_items`. Clean.

### votes.ts
`set_like` reduced to a single `user_items` upsert. `type` parameter correctly removed. `record_click` unchanged — keeps `item_type` as denormalized analytics convenience.

### import-datasets.ts
Both importers correctly two-step: `INSERT OR IGNORE INTO items` first, then detail tables via URL bridge. The "fill empty caption" upsert on pictures uses `ON CONFLICT(item_id) DO UPDATE SET caption = ... WHERE pictures.caption = ''` without `INSERT OR IGNORE`, which is the correct upsert form. SQL string interpolation for dataset names is escaped (`replace(/'/g, "''")`) and comes from internal reference DB metadata, not user input — matches the pre-existing pattern.

### e2e/global-setup.ts
Two-step import pattern correctly mirrored. Minor cosmetic issue: the count log at line 166 uses the outer-scope `e2e_db_path` (`e2e/fixtures/scrollsurf-e2e-test.db`) but the actual DB being seeded is `e2e/.data/scrollsurf.db`. Seeding itself is correct; only the log path is wrong. Not blocking.

### test-db.ts helpers
`insert_article`/`insert_picture` correctly insert into `items` + detail + `item_topics`/`item_categories` and return `items.id`. `set_like` writes to `user_items`. Clean.

### Test files
- Affinity tests are correctly isolated by type (each test inserts only articles or only pictures), so filtering `get_next_feed` results by `.type` is safe and accurate
- `migrate.test.ts` covers: fresh DB schema, legacy prod DB convergence, idempotency, v5-specific schema assertions, and a data-preservation case that seeds v4 data, migrates, and verifies votes/clicks/content/topics all survive
- All edge cases from the plan are covered

## Summary
Implementation matches the plan precisely. Migration is correct, the type-agnostic affinity path is cleaner and O(1) in type count, and all verification steps pass. The minor log path mismatch in global-setup.ts is cosmetic only.
