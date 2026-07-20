#!/usr/bin/env node
import {
  ADAPTERS,
  assertThreshold,
  ensurePerfServers,
  openAdapter,
  withBrowser,
  writePerfResult,
} from './lib/editor-perf.mjs';

const results = {};

await ensurePerfServers();

await withBrowser(async (page) => {
  for (const adapter of ADAPTERS) {
    const started = performance.now();
    await openAdapter(page, adapter);
    results[adapter.name] = Math.round(performance.now() - started);
  }
});

writePerfResult('cold-start', { unit: 'ms', results });

assertThreshold(results.vue <= 1500, `Vue cold-start ${results.vue}ms exceeds 1500ms budget`);
if (results.react > 0) {
  const ratio = results.vue / results.react;
  assertThreshold(ratio <= 1.25, `Vue cold-start is ${(ratio * 100).toFixed(1)}% of React`);
}
