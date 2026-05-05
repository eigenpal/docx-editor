import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/header-with-table.docx';

// Serial — under heavy parallel load multiple Playwright pages hit the same
// Vite dev server and race on module transforms, occasionally producing an
// empty header on first paint. The render itself is deterministic; this
// only stabilises the test harness.
test.describe.configure({ mode: 'serial' });

test.describe('Header tables render in the paginated view (#356)', () => {
  test('header table appears in the normal paginated render, not just edit mode', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number]');

    // Wait for the header table fragment to appear: the regression in #356
    // is that this fragment never renders, so this assertion is the
    // primary signal. Generous timeout under parallel test load — the dev
    // server can be slow to transform modules when many specs share it.
    const headerEl = page.locator('.layout-page-header').first();
    const tableInHeader = headerEl.locator('[data-from-row]');
    await expect(tableInHeader).toHaveCount(1, { timeout: 15000 });

    // Body still renders correctly.
    const body = page.locator('.layout-page-content').first();
    await expect(body).toContainText('BODY TEXT');

    // Both cell texts render (was silently dropped on the paginated path
    // before the unification).
    const headerText = (await headerEl.textContent()) ?? '';
    expect(headerText).toContain('HEADER LOGO');
    expect(headerText).toContain('HEADER TEXT');
  });

  test('header table preserves layout across enter/exit edit mode (#358)', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number]');
    await page.waitForTimeout(1000);

    const measureFirstPageTop = async () => {
      return page.evaluate(() => {
        const body = document.querySelector<HTMLElement>('.layout-page-content');
        return body ? Math.round(body.getBoundingClientRect().top) : null;
      });
    };

    const before = await measureFirstPageTop();
    expect(before).not.toBeNull();

    // Double-click into the header to enter edit mode, then press Escape to
    // exit. Body content's vertical position should be stable.
    await page.locator('.layout-page-header').first().dblclick();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const after = await measureFirstPageTop();
    expect(after).not.toBeNull();

    // Tolerance of 2px to absorb subpixel rendering noise.
    expect(Math.abs((after ?? 0) - (before ?? 0))).toBeLessThanOrEqual(2);
  });
});
