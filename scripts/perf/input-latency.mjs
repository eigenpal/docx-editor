#!/usr/bin/env node
import {
  ADAPTERS,
  assertThreshold,
  ensurePerfServers,
  openAdapter,
  PARA_ID_FIXTURE,
  percentile,
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
    const samples = await page.evaluate(async () => {
      const hook = window.__DOCX_EDITOR_E2E__;
      const paraId = hook?.getFirstTextblockParaId();
      if (!hook || !paraId) return [];
      const out = [];
      for (let i = 0; i < 12; i++) {
        const started = performance.now();
        hook.agentProposeChange({
          paraId,
          search: '',
          replaceWith: String.fromCharCode(97 + (i % 26)),
          author: 'Perf',
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        out.push(performance.now() - started);
      }
      return out;
    });
    results[adapter.name] = {
      p95: Math.round(percentile(samples, 95)),
      samples: samples.map((value) => Math.round(value)),
    };
  }
});

writePerfResult('input-latency', { unit: 'ms', results });

if (results.react?.p95 > 0) {
  const ratio = results.vue.p95 / results.react.p95;
  assertThreshold(ratio <= 1.1, `Vue input p95 is ${(ratio * 100).toFixed(1)}% of React`);
}
