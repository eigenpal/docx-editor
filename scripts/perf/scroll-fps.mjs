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
    results[adapter.name] = await page.evaluate(async () => {
      function findScrollableAncestor(start) {
        let current = start?.parentElement ?? null;
        while (current) {
          if (current.scrollHeight > current.clientHeight + 1) return current;
          current = current.parentElement;
        }
        return document.scrollingElement;
      }
      const pages =
        document.querySelector('.docx-editor-vue__pages-viewport') ??
        document.querySelector('.paged-editor__pages');
      const scroller = pages?.classList.contains('docx-editor-vue__pages-viewport')
        ? pages
        : findScrollableAncestor(pages);
      if (!scroller) return { fps: 0, frames: 0 };
      let frames = 0;
      const initialScrollTop = scroller.scrollTop;
      const started = performance.now();
      await new Promise((resolve) => {
        function tick(now) {
          frames++;
          scroller.scrollTop += 24;
          if (now - started >= 1000) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      return {
        fps: frames,
        frames,
        scrolledBy: Math.round(scroller.scrollTop - initialScrollTop),
      };
    });
  }
});

writePerfResult('scroll-fps', { unit: 'fps', results });

assertThreshold(results.vue.fps >= 50, `Vue scroll FPS ${results.vue.fps} is below 50fps budget`);
for (const adapter of ADAPTERS) {
  assertThreshold(
    results[adapter.name].scrolledBy > 0,
    `${adapter.name} scroll FPS did not move the editor scroll container`
  );
}
