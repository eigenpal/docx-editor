import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/header-with-table.docx';

test.describe.configure({ mode: 'serial' });

test.describe('HF inline editor: toolbar + context menu + z-index (#384, #385)', () => {
  test('clicking a header table cell shows the Table toolbar group (#384)', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number]');
    await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
      timeout: 15000,
    });

    // Toolbar should NOT show table group while body is focused.
    await expect(page.locator('[role="group"][aria-label="Table"]')).toHaveCount(0);

    // Open the inline header editor and click into the first header table cell.
    await page.locator('.layout-page-header').first().dblclick();
    await page.locator('.hf-inline-editor').waitFor();
    const headerCell = page.locator('.hf-inline-editor td, .hf-inline-editor th').first();
    await headerCell.click();

    // Toolbar table group should now be visible — auto-retried by expect.
    await expect(page.locator('[role="group"][aria-label="Table"]')).toHaveCount(1);
  });

  test('right-click in a header table cell shows context menu with table actions (#384)', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number]');
    await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
      timeout: 15000,
    });

    await page.locator('.layout-page-header').first().dblclick();
    await page.locator('.hf-inline-editor').waitFor();
    const headerCell = page.locator('.hf-inline-editor td, .hf-inline-editor th').first();
    await headerCell.click({ button: 'right' });

    // The context menu opens and contains a table-specific action.
    const insertRow = page.getByRole('menuitem', { name: /Insert row/i }).first();
    await expect(insertRow).toBeVisible({ timeout: 3000 });
  });

  test('horizontal ruler stays above the inline HF editor (#385)', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number]');

    await page.locator('.layout-page-header').first().dblclick();
    await page.locator('.hf-inline-editor').waitFor();

    // Read computed z-index for the ruler container vs the HF editor.
    const z = await page.evaluate(() => {
      const ruler = document.querySelector('.docx-horizontal-ruler')?.parentElement;
      const hf = document.querySelector('.hf-inline-editor');
      const get = (el: Element | null | undefined): number => {
        if (!el) return Number.NaN;
        const v = parseInt(window.getComputedStyle(el).zIndex, 10);
        return Number.isNaN(v) ? 0 : v;
      };
      return { ruler: get(ruler), hf: get(hf) };
    });

    expect(z.ruler).toBeGreaterThan(z.hf);
  });
});
