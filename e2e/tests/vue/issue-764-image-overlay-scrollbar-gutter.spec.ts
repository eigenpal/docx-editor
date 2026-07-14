/**
 * Vue regression for #764 — the image selection frame was shifted right on
 * platforms with classic (non-overlay) scrollbars, because the scroll
 * container uses `scrollbar-gutter: stable both-edges` and the overlay math
 * didn't subtract the reserved inline-start gutter.
 *
 * macOS (and default Chromium) uses OVERLAY scrollbars, so
 * `offsetWidth - clientWidth` stays 0 even with `scrollbar-gutter: stable
 * both-edges` and injected `::-webkit-scrollbar { width }` rules. The gutter
 * correction is covered by `imageOverlayRect.test.ts`; this e2e asserts the
 * frame still wraps the image (no-op path on overlay scrollbars, corrected
 * path when a classic gutter is actually reserved).
 */
import { test, expect, type Page } from '@playwright/test';

const FIXTURE = 'e2e/fixtures/image-layout-modes-demo.docx';
const INLINE_IMAGE = '.layout-line .layout-run-image';
const OVERLAY = '.image-overlay';

async function forceClassicScrollbar(page: Page) {
  await page.addStyleTag({
    content: `.docx-editor-vue__pages-viewport::-webkit-scrollbar { width: 15px !important; height: 15px !important; }
              .docx-editor-vue__pages-viewport::-webkit-scrollbar-thumb { background: #888; }`,
  });
}

test('image frame stays aligned with a reserved scrollbar gutter (#764)', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();
  await forceClassicScrollbar(page);
  await page.locator('input[type="file"][accept=".docx"]').first().setInputFiles(FIXTURE);
  await page.waitForSelector('[data-page-number]');
  await page.locator(INLINE_IMAGE).first().waitFor();

  const gutter = await page.evaluate(() => {
    const v = document.querySelector('.docx-editor-vue__pages-viewport') as HTMLElement | null;
    return v ? (v.offsetWidth - v.clientWidth) / 2 : 0;
  });
  // Classic-scrollbar platforms reserve a both-edges gutter; overlay-scrollbar
  // platforms (macOS) keep gutter=0 and exercise the no-op correction path.
  if (gutter > 5) {
    expect(gutter, 'classic scrollbar reserved a non-trivial inline-start gutter').toBeGreaterThan(
      5
    );
  }

  // Select the image and let the overlay settle.
  await page.locator(INLINE_IMAGE).first().click();
  await page.waitForSelector(OVERLAY);
  await page.waitForTimeout(400);

  const offset = await page.evaluate(
    ({ overlaySel, imgSel }) => {
      const ov = document.querySelector(overlaySel) as HTMLElement | null;
      const img = document.querySelector(imgSel) as HTMLElement | null;
      if (!ov || !img) return { ok: false, dxLeft: Infinity, dxTop: Infinity };
      const o = ov.getBoundingClientRect();
      const i = img.getBoundingClientRect();
      return { ok: true, dxLeft: Math.abs(o.left - i.left), dxTop: Math.abs(o.top - i.top) };
    },
    { overlaySel: OVERLAY, imgSel: INLINE_IMAGE }
  );

  expect(offset.ok).toBe(true);
  // The frame wraps the image tightly — within a couple of px on every edge,
  // NOT shifted right by a reserved gutter (the #764 symptom when gutter > 0).
  expect(offset.dxLeft).toBeLessThan(2);
  expect(offset.dxTop).toBeLessThan(2);
});
