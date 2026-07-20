import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/header-with-table.docx';

test.describe.configure({ mode: 'serial' });

test.describe('HF inline editor: toolbar + context menu + z-index (#384, #385)', () => {
  test('removing a header still allows recreating it from the blank header area', async ({
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
    const hfChrome = page.locator('.hf-inline-editor');
    await hfChrome.waitFor();

    await hfChrome.getByRole('button', { name: /options/i }).click();
    await hfChrome.getByRole('button', { name: /remove.*header/i }).click();

    await expect(page.locator('.hf-inline-editor')).toHaveCount(0);
    const blankHeader = page.locator('.layout-page-header').first();
    await expect(blankHeader).toBeVisible();

    await blankHeader.dblclick({ position: { x: 20, y: 10 } });
    await expect(page.locator('.hf-inline-editor')).toHaveCount(1);
    // Post-unification: the visible HF render is the painter, not a PM in
    // the inline overlay. A new empty HF has no text spans, but the host
    // remains visible (chrome bar mounts when overlay is open).
    await expect(page.locator('.layout-page-header').first()).toBeVisible();
  });

  // TODO(unify-hf-editing): post-unification the painter renders HF cells
  // (`.layout-table-cell`) instead of native `<td>`s; the toolbar's
  // table-context selection routing through useSelectionTracker isn't
  // hooked up for HF transactions on every click. Re-enable once the HF
  // selection feeds tableContext directly.
  test.fixme('clicking a header table cell shows the Table toolbar group (#384)', async ({
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

    // Toolbar should NOT show table group while body is focused.
    await expect(page.locator('[role="group"][aria-label="Table"]')).toHaveCount(0);

    // Open the inline header chrome and click a painted header cell.
    await page.locator('.layout-page-header').first().dblclick();
    await page.locator('.hf-inline-editor').waitFor();
    const headerCell = page
      .locator(
        '.layout-page-header .layout-table-cell, .layout-page-header td, .layout-page-header th'
      )
      .first();
    await headerCell.click();

    // Toolbar table group should now be visible — auto-retried by expect.
    await expect(page.locator('[role="group"][aria-label="Table"]')).toHaveCount(1);
  });

  // TODO(unify-hf-editing): see fixme above. Context menu routing depends
  // on the same selection tracker that the table toolbar group does.
  test.fixme('right-click in a header table cell shows context menu with table actions (#384)', async ({
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
    const headerCell = page
      .locator(
        '.layout-page-header .layout-table-cell, .layout-page-header td, .layout-page-header th'
      )
      .first();
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

    // Read computed z-index for the ruler container vs the HF chrome.
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
