import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, summarize } from './edit-browser-bench-harness.ts';

// Isolates drawing-key aggregation in Chromium. This is a work microbenchmark,
// not an input-to-frame benchmark. Run the edit browser benchmark separately.
test('drawing resource aggregation on repeated and changed layouts', async ({ page, browser }) => {
  await page.goto('http://localhost:5275/@vite/client');
  const moduleUrl = `/@fs/${resolve(REPO_ROOT, 'packages/core/src/output/semantic-paint-drawings.ts')}`;
  const result = await page.evaluate(async (moduleUrl) => {
    const { collectUsedDrawingResourceKeys, collectUsedDrawingElementKeys } = await import(
      /* @vite-ignore */ moduleUrl
    );
    const pageCount = 500;
    const iterations = 20_000;
    const box = Object.freeze({ x: 0, y: 0, width: 612, height: 792 });
    // Only fields read by the collector are needed for this synthetic workload.
    const pages = Object.freeze(
      Array.from({ length: pageCount }, (_, index) =>
        Object.freeze({
          index,
          box,
          contentBox: box,
          fragments: Object.freeze([]),
          anchoredDrawings: Object.freeze([
            Object.freeze({
              drawingNodeId: `drawing-${index}`,
              resource: Object.freeze({ kind: 'ready', resourceKey: `resource-${index % 10}` }),
            }),
          ]),
        })
      )
    );
    const layout = Object.freeze({ revision: 1, pages });
    const sample = (changed: boolean) => {
      let checksum = 0;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const input = changed ? Object.freeze({ revision: i, pages }) : layout;
        checksum += collectUsedDrawingResourceKeys(input).size;
        checksum += collectUsedDrawingElementKeys(input).size;
      }
      return { ms: performance.now() - start, checksum };
    };
    sample(false);
    sample(true);
    const repeated = [];
    const changed = [];
    for (let round = 0; round < 7; round++) {
      repeated.push(sample(false));
      changed.push(sample(true));
    }
    return { pageCount, iterations, repeated, changed };
  }, moduleUrl);
  for (const sample of [...result.repeated, ...result.changed]) {
    expect(sample.checksum).toBe(result.iterations * (result.pageCount + 10));
  }
  const report = {
    browser: browser.version(),
    ...result,
    repeatedSummary: summarize(result.repeated.map(({ ms }) => ms)),
    changedSummary: summarize(result.changed.map(({ ms }) => ms)),
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.env.DRAWING_KEYS_BROWSER_BENCH_OUTPUT) {
    writeFileSync(process.env.DRAWING_KEYS_BROWSER_BENCH_OUTPUT, JSON.stringify(report, null, 2));
  }
});
