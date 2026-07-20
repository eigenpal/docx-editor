import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/footer-page-number.docx';

/**
 * Regression: a PAGE field in a footer must render with the field result
 * run's own character formatting (font size / color), not the painter's
 * hardcoded defaults. Every run in this footer carries `w:sz=15` (7.5pt) +
 * `w:color` 404040, so the painted footer must be visually uniform. Before
 * the bridge extracted the field node's marks, the page number painted at
 * the default ~11pt black while the rest stayed 7.5pt grey.
 */
test.describe('Footer PAGE field formatting', () => {
  test('page number matches the rest of the footer run formatting', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number="1"]');
    await page.waitForTimeout(1500);

    const footer = page.locator('[data-page-number="1"] .layout-page-footer');
    await expect(footer).toContainText('Page');

    // Collect computed font-size + color of every painted text span in the
    // footer. The whole footer shares one w:rPr, so they must be uniform.
    const styles = await footer.locator('.layout-run-text').evaluateAll((els) =>
      els
        .filter((el) => (el.textContent ?? '').trim().length > 0)
        .map((el) => {
          const cs = getComputedStyle(el);
          return { text: el.textContent, fontSize: cs.fontSize, color: cs.color };
        })
    );

    expect(styles.length).toBeGreaterThan(1);
    const pageNumber = styles.find((s) => /^\s*\d+\s*$/.test(s.text ?? ''));
    expect(pageNumber, 'painted page number span not found').toBeTruthy();

    const uniqueSizes = new Set(styles.map((s) => s.fontSize));
    const uniqueColors = new Set(styles.map((s) => s.color));
    expect(uniqueSizes.size, `mixed font sizes: ${[...uniqueSizes].join(', ')}`).toBe(1);
    expect(uniqueColors.size, `mixed colors: ${[...uniqueColors].join(', ')}`).toBe(1);
  });
});
