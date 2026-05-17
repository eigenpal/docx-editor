import path from 'node:path';
import { expect, forEachAdapter } from '../parity-fixture';

const FIXTURE = path.resolve('e2e/fixtures/footnote-bottom-overflow.docx');

/**
 * Parity test for the multi-pass footnote convergence loop
 * (`stabilizeFootnoteLayout` in core). Both adapters call the same
 * helper, so dense footnote areas should stay inside their page bottoms
 * regardless of which adapter renders the document.
 */
forEachAdapter('smoke: dense footnotes stay inside page bottom', async (adapter, { page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 });
  await page.goto(`${adapter.baseUrl}/?e2e=1`);
  await page.waitForSelector(adapter.readySelector, { timeout: 25000 });
  await page.waitForSelector('.paged-editor__pages', { timeout: 25000 });
  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE);
  await page.waitForSelector('.layout-footnote-area', { timeout: 25000 });
  // Give the multi-pass layout time to converge before measuring.
  await page.waitForTimeout(1000);

  const metrics = await page.evaluate(() => {
    const pages = Array.from(document.querySelectorAll<HTMLElement>('.layout-page'));
    return pages
      .map((pageEl) => {
        const pageRect = pageEl.getBoundingClientRect();
        const footnoteArea = pageEl.querySelector<HTMLElement>('.layout-footnote-area');
        if (!footnoteArea) return null;
        const areaRect = footnoteArea.getBoundingClientRect();
        return {
          bottomOverflow: Math.round(areaRect.bottom - pageRect.bottom),
          topGap: Math.round(areaRect.top - pageRect.top),
        };
      })
      .filter(Boolean);
  });

  expect(metrics.length).toBeGreaterThan(0);
  for (const metric of metrics) {
    expect(metric!.topGap).toBeGreaterThanOrEqual(0);
    expect(metric!.bottomOverflow).toBeLessThanOrEqual(1);
  }
});
