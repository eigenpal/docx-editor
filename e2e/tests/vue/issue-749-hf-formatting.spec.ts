import { test, expect } from '@playwright/test';

/**
 * Regression for #749 — while editing a header/footer, the main formatting
 * toolbar must apply to the HF text, not the body. The Vue toolbar dispatched
 * to the body `editorView` regardless; it now targets the active HF view.
 */
test('Vue: toolbar formatting applies to the header while editing it (#749)', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles('e2e/fixtures/header-with-table.docx');

  await page.waitForSelector('[data-page-number]');
  await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
    timeout: 15000,
  });

  // Enter HF edit mode and select the header text.
  await page.locator('.layout-page-header').first().dblclick();
  await expect(page.locator('.hf-editor')).toHaveCount(1);
  const headerSpan = page
    .locator('.layout-page-header .layout-table-cell span[data-doc-from]')
    .first();
  await headerSpan.click();
  await page.keyboard.press('Meta+a');
  await page.waitForTimeout(150);

  const headerWeight = () =>
    page.evaluate(() => {
      const el = document.querySelector(
        '.layout-page-header .layout-table-cell span[data-doc-from]'
      ) as Element | null;
      return el ? getComputedStyle(el).fontWeight : null;
    });

  // Sanity: header text is not bold to begin with.
  expect(Number(await headerWeight())).toBeLessThan(600);

  // Click Bold on the main toolbar.
  const boldBtn = page.locator('[aria-label="Bold"]').first();
  await boldBtn.click();
  await page.waitForTimeout(250);

  // Header run is now bold...
  await expect.poll(async () => Number(await headerWeight())).toBeGreaterThanOrEqual(600);

  // ...and the toolbar reflects it — the Bold button is active. Guards that HF
  // transactions refresh toolbar state, not just apply the command (#749).
  await expect(boldBtn).toHaveClass(/active/);

  // ...and the body was not touched.
  const bodyWeight = await page.evaluate(() => {
    const el = document.querySelector('.layout-page-content .layout-run-text') as Element | null;
    return el ? getComputedStyle(el).fontWeight : null;
  });
  expect(Number(bodyWeight)).toBeLessThan(600);
});
