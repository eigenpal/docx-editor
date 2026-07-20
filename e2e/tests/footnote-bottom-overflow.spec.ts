import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/footnote-bottom-overflow.docx';
const SPLIT_PARAGRAPH_FIXTURE = 'fixtures/footnote-overlap-regression.docx';

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

  test('does not overlap body fragments when a referenced paragraph splits', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 1100 });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile(SPLIT_PARAGRAPH_FIXTURE);
    await page.waitForSelector('.layout-footnote-area');
    await expect(
      page.locator('.layout-footnote-area').filter({ hasText: 'generated-source-11.txt' })
    ).toHaveCount(1);
    await page.waitForTimeout(1000);

    const metrics = await page.evaluate(() => {
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
          const overlappingBody = Array.from(content.children)
            .filter((child): child is HTMLElement => child instanceof HTMLElement)
            .filter(
              (child) => !Array.from(child.classList).some((name) => ignoredClasses.has(name))
            )
            .map((child) => {
              const rect = child.getBoundingClientRect();
              const overlap =
                Math.min(rect.bottom, areaRect.bottom) - Math.max(rect.top, areaRect.top);
              return {
                pageNumber: pageEl.dataset.pageNumber ?? '',
                className: child.className,
                blockId: child.dataset.blockId ?? '',
                overlap: Math.round(overlap),
              };
            })
            .filter((item) => item.overlap > 1);

          return overlappingBody;
        }
      );
    });

    expect(metrics).toEqual([]);
  });
});
