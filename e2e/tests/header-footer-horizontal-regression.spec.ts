import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const HORIZONTAL_FIXTURE = 'fixtures/generic-header-footer-horizontal-regression.docx';

type AreaMetrics = {
  section: 'header' | 'footer';
  containerWidth: number;
  imageWidth: number;
  pageWidth: number;
  centerDelta: number;
};

async function collectAreaMetrics(page: Page): Promise<AreaMetrics[]> {
  return page.evaluate(() => {
    const pageEl = document.querySelector<HTMLElement>('.layout-page');
    if (!pageEl) return [];

    const pageRect = pageEl.getBoundingClientRect();

    return (['header', 'footer'] as const)
      .map((section) => {
        const areaEl = pageEl.querySelector<HTMLElement>(`.layout-page-${section}`);
        const imgEl = areaEl?.querySelector<HTMLImageElement>('img');
        if (!areaEl || !imgEl) return null;

        const areaRect = areaEl.getBoundingClientRect();
        const imgRect = imgEl.getBoundingClientRect();
        const pageCenter = pageRect.left + pageRect.width / 2;
        const imageCenter = imgRect.left + imgRect.width / 2;

        return {
          section,
          containerWidth: Math.round(areaRect.width),
          imageWidth: Math.round(imgRect.width),
          pageWidth: Math.round(pageRect.width),
          centerDelta: Math.round(imageCenter - pageCenter),
        } satisfies AreaMetrics;
      })
      .filter((value): value is AreaMetrics => value !== null);
  });
}

test.describe('Header/Footer Horizontal Regression', () => {
  test('preserves full-width anchored header and footer media', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page
      .locator('input[type="file"][accept=".docx"]')
      .setInputFiles(`e2e/${HORIZONTAL_FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number]');
    await page.waitForTimeout(1500);

    const metrics = await collectAreaMetrics(page);
    const header = metrics.find((item) => item.section === 'header');
    const footer = metrics.find((item) => item.section === 'footer');

    expect(header).toBeTruthy();
    expect(footer).toBeTruthy();

    for (const area of metrics) {
      expect(area.imageWidth).toBeGreaterThan(area.containerWidth);
    }

    expect(Math.abs(header!.centerDelta)).toBeLessThanOrEqual(6);
    // This footer banner is slightly left-biased in the source anchor geometry,
    // but it should stay close to centered rather than drifting far left.
    expect(Math.abs(footer!.centerDelta)).toBeLessThanOrEqual(16);
    expect(footer!.imageWidth).toBeGreaterThan(footer!.pageWidth);
  });
});
