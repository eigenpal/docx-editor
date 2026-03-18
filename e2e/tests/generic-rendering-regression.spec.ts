/**
 * Generic rendering regression for image layout issues.
 *
 * Uses a sanitized fixture (no private business content) that preserves
 * the problematic structure:
 * - header media that can be clipped when header container overflow is hidden
 * - inline body image run that must not be duplicated in painted output
 */
import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const GENERIC_FIXTURE = 'fixtures/generic-render-regression.docx';

interface RenderAnomalies {
  bodyImagePmKeyCount: number;
  anchoredHeaderContainers: number;
  duplicateBodyPmImages: Array<{ key: string; count: number }>;
  clippedHeaderImages: Array<{
    top: number;
    bottom: number;
    pageTop: number;
    pageBottom: number;
    headerTop: number;
    headerStyleTop: number;
  }>;
}

async function collectRenderAnomalies(page: Page): Promise<RenderAnomalies> {
  return page.evaluate(() => {
    const duplicateCounter = new Map<string, number>();
    const bodyImages = Array.from(
      document.querySelectorAll<HTMLElement>('.layout-page-content img[data-pm-start][data-pm-end]')
    );

    for (const img of bodyImages) {
      const paragraph = img.closest<HTMLElement>('.layout-paragraph');
      const key = [
        paragraph?.dataset.blockId ?? 'no-block',
        img.dataset.pmStart ?? '',
        img.dataset.pmEnd ?? '',
      ].join('|');
      duplicateCounter.set(key, (duplicateCounter.get(key) ?? 0) + 1);
    }

    const duplicateBodyPmImages = Array.from(duplicateCounter.entries())
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count }));

    let anchoredHeaderContainers = 0;
    const clippedHeaderImages: Array<{
      top: number;
      bottom: number;
      pageTop: number;
      pageBottom: number;
      headerTop: number;
      headerStyleTop: number;
    }> = [];
    const headerEls = Array.from(document.querySelectorAll<HTMLElement>('.layout-page-header'));

    for (const headerEl of headerEls) {
      const headerStyleTop = Number.parseFloat(headerEl.style.top || '0');
      const headerRect = headerEl.getBoundingClientRect();
      const pageRect = headerEl.closest<HTMLElement>('.layout-page')?.getBoundingClientRect();
      const images = Array.from(headerEl.querySelectorAll('img'));
      if (images.length > 0 && headerStyleTop < 44) {
        anchoredHeaderContainers += 1;
      }
      for (const img of images) {
        const imgRect = img.getBoundingClientRect();
        if (
          pageRect &&
          (imgRect.top < pageRect.top - 0.5 || imgRect.bottom > pageRect.bottom + 0.5)
        ) {
          clippedHeaderImages.push({
            top: Math.round(imgRect.top),
            bottom: Math.round(imgRect.bottom),
            pageTop: Math.round(pageRect.top),
            pageBottom: Math.round(pageRect.bottom),
            headerTop: Math.round(headerRect.top),
            headerStyleTop: Math.round(headerStyleTop),
          });
        }
      }
    }

    return {
      bodyImagePmKeyCount: duplicateCounter.size,
      anchoredHeaderContainers,
      duplicateBodyPmImages,
      clippedHeaderImages,
    };
  });
}

test.describe('Generic Rendering Regression', () => {
  test('does not duplicate body images or clip header media', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page
      .locator('input[type="file"][accept=".docx"]')
      .setInputFiles(`e2e/${GENERIC_FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number]');
    await page.waitForTimeout(1500);

    const anomalies = await collectRenderAnomalies(page);

    // Guardrails: ensure this fixture still exercises both paths.
    expect(anomalies.bodyImagePmKeyCount).toBeGreaterThan(0);
    expect(anomalies.anchoredHeaderContainers).toBeGreaterThan(0);

    // Regression checks.
    expect(anomalies.duplicateBodyPmImages).toEqual([]);
    expect(anomalies.clippedHeaderImages).toEqual([]);
  });
});
