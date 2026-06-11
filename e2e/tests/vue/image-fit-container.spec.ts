/**
 * Vue counterpart: a wide image in the body fits the page content width while
 * keeping its aspect ratio — it does not overflow the page. Mirrors the React
 * test; the fit lives in the shared core painter.
 */
import { test, expect } from '@playwright/test';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMPTY_DOCX = path.join(__dirname, '..', '..', 'fixtures', 'empty.docx');

const WIDE_IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('Vue: a wide image in the body fits the page width and keeps its aspect ratio', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();
  await page.waitForSelector('[data-page-number]', { timeout: 15000 });
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(EMPTY_DOCX);
  await page.waitForTimeout(500);

  await page.evaluate((src) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const e2e = (window as any).__DOCX_EDITOR_E2E__;
    const view = e2e.getView();
    const TS = view.state.selection.constructor;
    view.dispatch(view.state.tr.setSelection(TS.create(view.state.doc, 1)));
    const node = view.state.schema.nodes.image.create({
      src,
      width: 900,
      height: 225, // 4:1, wider than the page content
      wrapType: 'inline',
      displayMode: 'inline',
    });
    view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }, WIDE_IMG);

  const img = page.locator('.layout-run-image').first();
  await expect(img).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(300);

  const m = await img.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const content = el.closest('.layout-page-content') as HTMLElement | null;
    const cr = content?.getBoundingClientRect();
    return {
      w: r.width,
      h: r.height,
      overflows: cr ? r.right > cr.right + 1 : null,
      contentW: cr ? cr.width : null,
    };
  });
  expect(m.w / m.h).toBeCloseTo(4, 1); // aspect preserved
  expect(m.overflows).toBe(false); // does not overflow the page
  expect(m.w).toBeLessThanOrEqual(m.contentW! + 1);
});
