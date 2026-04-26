/**
 * P1/P2: scrollToParaId + scrollToPosition (paginated editor, virtualization-friendly path).
 * Relies on `window.__DOCX_EDITOR_E2E__` from the Vite demo (examples/vite).
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function waitPaintedInViewport(
  page: import('@playwright/test').Page,
  docFrom: number | null,
  timeout = 20000
): Promise<void> {
  await page.waitForFunction(
    (pos) => {
      if (pos == null) return false;
      const pages = document.querySelector('.paged-editor__pages');
      if (!pages) return false;
      const el = pages.querySelector(`[data-doc-from="${pos}"]`);
      if (!(el instanceof HTMLElement)) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    },
    docFrom,
    { timeout }
  );
}

test.describe('Scroll to paragraph / position (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
  });

  test('scrollToParaId returns false for unknown paraId', async ({ page }) => {
    const ok = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.scrollToParaId('__NO_SUCH_PARA_ID__') ?? null
    );
    expect(ok).toBe(false);
  });

  test('scrollToParaId brings first paragraph paraId into viewport', async ({ page }) => {
    const firstId = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.getFirstTextblockParaId() ?? null
    );
    test.skip(!firstId, 'Demo document has no paragraph paraIds');

    const start = await page.evaluate(
      (id) => window.__DOCX_EDITOR_E2E__?.getPmStartForParaId(id) ?? null,
      firstId
    );
    expect(start).not.toBeNull();

    await page.evaluate((id) => {
      window.__DOCX_EDITOR_E2E__?.scrollToParaId(id);
    }, firstId);

    await waitPaintedInViewport(page, start);
  });

  test('long jump: scroll to last paraId after scrolling to first', async ({ page }) => {
    const firstId = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.getFirstTextblockParaId() ?? null
    );
    const lastId = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.getLastTextblockParaId() ?? null
    );
    test.skip(!firstId || !lastId, 'Demo document needs paragraph paraIds');
    test.skip(firstId === lastId, 'Demo needs at least two distinct paragraph paraIds');

    const firstStart = await page.evaluate(
      (id) => window.__DOCX_EDITOR_E2E__?.getPmStartForParaId(id) ?? null,
      firstId
    );
    const lastStart = await page.evaluate(
      (id) => window.__DOCX_EDITOR_E2E__?.getPmStartForParaId(id) ?? null,
      lastId
    );
    expect(firstStart).not.toBeNull();
    expect(lastStart).not.toBeNull();

    await page.evaluate((id) => {
      window.__DOCX_EDITOR_E2E__?.scrollToParaId(id);
    }, firstId);
    await waitPaintedInViewport(page, firstStart);

    await page.evaluate((id) => {
      window.__DOCX_EDITOR_E2E__?.scrollToParaId(id);
    }, lastId);
    await waitPaintedInViewport(page, lastStart, 25000);
  });

  test('scrollToPosition brings pm start into viewport (P2)', async ({ page }) => {
    const firstId = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.getFirstTextblockParaId() ?? null
    );
    test.skip(!firstId, 'Demo document has no paragraph paraIds');

    const pos = await page.evaluate(
      (id) => window.__DOCX_EDITOR_E2E__?.getPmStartForParaId(id) ?? null,
      firstId
    );
    expect(pos).not.toBeNull();

    await page.evaluate((p) => {
      window.__DOCX_EDITOR_E2E__?.scrollToPosition(p);
    }, pos);

    await waitPaintedInViewport(page, pos);
  });
});
