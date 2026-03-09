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
  potentialClippedHeaderImages: number;
  duplicateBodyPmImages: Array<{ key: string; count: number }>;
  clippedHeaderImages: Array<{ top: number; bottom: number; headerBottom: number }>;
}

async function collectRenderAnomalies(page: Page): Promise<RenderAnomalies> {
  return page.evaluate(() => {
    const duplicateCounter = new Map<string, number>();
    const bodyImages = Array.from(
      document.querySelectorAll<HTMLElement>('.layout-page-content img[data-doc-from][data-doc-to]')
    );

    for (const img of bodyImages) {
      const paragraph = img.closest<HTMLElement>('.layout-paragraph');
      const key = [
        paragraph?.dataset.blockId ?? 'no-block',
        img.dataset.docFrom ?? '',
        img.dataset.docTo ?? '',
      ].join('|');
      duplicateCounter.set(key, (duplicateCounter.get(key) ?? 0) + 1);
    }

    const duplicateBodyPmImages = Array.from(duplicateCounter.entries())
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count }));

    let potentialClippedHeaderImages = 0;
    const clippedHeaderImages: Array<{ top: number; bottom: number; headerBottom: number }> = [];
    const headerEls = Array.from(document.querySelectorAll<HTMLElement>('.layout-page-header'));

    for (const headerEl of headerEls) {
      const overflow = window.getComputedStyle(headerEl).overflowY;
      const headerRect = headerEl.getBoundingClientRect();
      const images = Array.from(headerEl.querySelectorAll('img'));
      for (const img of images) {
        const imgRect = img.getBoundingClientRect();
        if (imgRect.bottom > headerRect.bottom + 0.5) {
          potentialClippedHeaderImages += 1;
          if (overflow === 'hidden' || overflow === 'clip') {
            clippedHeaderImages.push({
              top: Math.round(imgRect.top),
              bottom: Math.round(imgRect.bottom),
              headerBottom: Math.round(headerRect.bottom),
            });
          }
        }
      }
    }

    return {
      bodyImagePmKeyCount: duplicateCounter.size,
      potentialClippedHeaderImages,
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
    expect(anomalies.potentialClippedHeaderImages).toBeGreaterThan(0);

    // Regression checks.
    expect(anomalies.duplicateBodyPmImages).toEqual([]);
    expect(anomalies.clippedHeaderImages).toEqual([]);
  });
});
