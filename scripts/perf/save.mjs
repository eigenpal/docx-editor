#!/usr/bin/env node
import {
  ADAPTERS,
  assertThreshold,
  ensurePerfServers,
  openAdapter,
  PARA_ID_FIXTURE,
  withBrowser,
  writePerfResult,
} from './lib/editor-perf.mjs';

const results = {};

await ensurePerfServers();

await withBrowser(async (page) => {
  for (const adapter of ADAPTERS) {
    await openAdapter(page, adapter);
    await page.locator('input[type="file"]').first().setInputFiles(PARA_ID_FIXTURE);
    await page.waitForFunction(() => Boolean(window.__DOCX_EDITOR_E2E__?.getFirstTextblockParaId()));
    const result = await page.evaluate(async () => {
      const started = performance.now();
      const byteLength = (await window.__DOCX_EDITOR_E2E__?.saveByteLength()) ?? 0;
      return { ms: Math.round(performance.now() - started), byteLength };
    });
    results[adapter.name] = result;
  }
});

writePerfResult('save', { unit: 'ms', results });

if (results.react?.ms >= 100) {
  const ratio = results.vue.ms / results.react.ms;
  assertThreshold(ratio <= 1.05, `Vue save is ${(ratio * 100).toFixed(1)}% of React`);
}
assertThreshold(results.vue.ms <= 500, `Vue save ${results.vue.ms}ms exceeds 500ms small-fixture budget`);
assertThreshold(results.vue.byteLength > 1000, 'Vue save did not return DOCX-sized bytes');
