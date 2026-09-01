// Phase 1 (discovery) re-runs on every download so upstream additions are picked
// up. This escape hatch skips it when only phase 2 needs to resume — e.g. a long
// content download interrupted midway, where re-reading the index pages is pure
// overhead.
export const skip_discovery = (): boolean =>
  process.argv.includes('--no-discover') || process.env.SKIP_DISCOVERY === '1';
