import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/footnote-bottom-overflow.docx';

async function loadFixture(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await editor.loadDocxFile(FIXTURE);
  await page.waitForSelector('.layout-footnote-area');
  await page.waitForTimeout(1000);
}

test.describe('footnote bottom overflow', () => {
  test('keeps dense footnote areas inside their pages', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1100 });
    await loadFixture(page);

    const metrics = await page.evaluate(() => {
      const pages = Array.from(document.querySelectorAll<HTMLElement>('.layout-page'));
      return pages
        .map((pageEl) => {
          const pageRect = pageEl.getBoundingClientRect();
          const footnoteArea = pageEl.querySelector<HTMLElement>('.layout-footnote-area');
          if (!footnoteArea) return null;

          const areaRect = footnoteArea.getBoundingClientRect();
          return {
            pageNumber: pageEl.dataset.pageNumber,
            bottomOverflow: Math.round(areaRect.bottom - pageRect.bottom),
            topGap: Math.round(areaRect.top - pageRect.top),
            text: footnoteArea.textContent ?? '',
          };
        })
        .filter(Boolean);
    });

    expect(metrics.length).toBeGreaterThan(0);
    for (const metric of metrics) {
      expect(metric!.topGap).toBeGreaterThanOrEqual(0);
      expect(metric!.bottomOverflow).toBeLessThanOrEqual(1);
    }
    expect(metrics.some((metric) => metric!.text.includes('sample-charlie-source-19'))).toBe(true);
  });
});
