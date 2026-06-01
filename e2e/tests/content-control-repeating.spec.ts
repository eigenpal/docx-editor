/**
 * Repeating-section UI (#622 phase 3 / Word parity): the ＋ affordance on a
 * repeating item adds a new item below; ✕ removes one (but not the last).
 * Driven through the real React editor against a w15:repeatingSection fixture.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import type { Page } from '@playwright/test';

function itemCount(page: Page): Promise<number> {
  // Each repeating item is a nested control; its ＋ button is unique per item.
  return page.locator('.layout-sdt-repeat-btn[data-sdt-repeat="add"]').count();
}

test.describe('Repeating section (#622)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile('fixtures/block-sdt-repeating.docx');
  });

  test('the ＋ affordance adds an item, ✕ removes it', async ({ page }) => {
    await expect.poll(() => itemCount(page)).toBe(2);
    // add after the first item
    await page.locator('.layout-sdt-repeat-btn[data-sdt-repeat="add"]').first().click();
    await expect.poll(() => itemCount(page)).toBe(3);
    // remove one
    await page.locator('.layout-sdt-repeat-btn[data-sdt-repeat="remove"]').first().click();
    await expect.poll(() => itemCount(page)).toBe(2);
  });

  test('removing is refused when only one item remains', async ({ page }) => {
    await expect.poll(() => itemCount(page)).toBe(2);
    await page.locator('.layout-sdt-repeat-btn[data-sdt-repeat="remove"]').first().click();
    await expect.poll(() => itemCount(page)).toBe(1);
    // clicking remove on the last item is a no-op (kept)
    await page.locator('.layout-sdt-repeat-btn[data-sdt-repeat="remove"]').first().click();
    await page.waitForTimeout(200);
    expect(await itemCount(page)).toBe(1);
  });
});
