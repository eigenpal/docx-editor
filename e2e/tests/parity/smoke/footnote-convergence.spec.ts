import path from 'node:path';
import { expect, forEachAdapter } from '../parity-fixture';

const FIXTURE = path.resolve('e2e/fixtures/footnote-bottom-overflow.docx');
const SPLIT_PARAGRAPH_FIXTURE = path.resolve('e2e/fixtures/footnote-overlap-regression.docx');

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

forEachAdapter(
  'smoke: split-paragraph footnotes do not overlap body text',
  async (adapter, { page }) => {
    await page.setViewportSize({ width: 1400, height: 1100 });
    await page.goto(`${adapter.baseUrl}/?e2e=1`);
    await page.waitForSelector(adapter.readySelector, { timeout: 25000 });
    await page.waitForSelector('.paged-editor__pages', { timeout: 25000 });
    await page.locator('input[type="file"]').first().setInputFiles(SPLIT_PARAGRAPH_FIXTURE);
    await page.waitForSelector('.layout-footnote-area', { timeout: 25000 });
    await expect(
      page.locator('.layout-footnote-area').filter({ hasText: 'generated-source-11.txt' })
    ).toHaveCount(1);
    await page.waitForTimeout(1000);

    const overlaps = await page.evaluate(() => {
      const ignoredClasses = new Set([
        'layout-footnote-area',
        'layout-floating-images-layer',
        'layout-sdt-boundary-box',
        'layout-page-border',
      ]);

      return Array.from(document.querySelectorAll<HTMLElement>('.layout-page')).flatMap(
        (pageEl) => {
          const footnoteArea = pageEl.querySelector<HTMLElement>('.layout-footnote-area');
          const content = pageEl.querySelector<HTMLElement>('.layout-page-content');
          if (!footnoteArea || !content) return [];

          const areaRect = footnoteArea.getBoundingClientRect();
          return Array.from(content.children)
            .filter((child): child is HTMLElement => child instanceof HTMLElement)
            .filter(
              (child) => !Array.from(child.classList).some((name) => ignoredClasses.has(name))
            )
            .map((child) => {
              const rect = child.getBoundingClientRect();
              return Math.round(
                Math.min(rect.bottom, areaRect.bottom) - Math.max(rect.top, areaRect.top)
              );
            })
            .filter((overlap) => overlap > 1);
        }
      );
    });

    expect(overlaps).toEqual([]);
  }
);
