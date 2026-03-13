import { test, expect } from '@playwright/test';

async function getWordCenter(page, word: string) {
  return await page.evaluate((target) => {
    const contentArea =
      document.querySelector('.paged-editor__pages') ||
      document.querySelector('.docx-editor-pages') ||
      document.querySelector('.docx-ai-editor');

    if (!contentArea) return null;

    const walker = document.createTreeWalker(contentArea, NodeFilter.SHOW_TEXT, null);
    let node: Text | null;

    while ((node = walker.nextNode() as Text | null)) {
      const text = node.textContent || '';
      const index = text.indexOf(target);
      if (index !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + target.length);
        const rect = range.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
    }

    return null;
  }, word);
}

test.describe('Spellcheck', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?toolbar=compact');
    await page.waitForSelector('[data-testid="docx-editor"]');
    await page.waitForTimeout(500);
  });

  test('shows unified context menu with spellcheck items', async ({ page }) => {
    const pages = page.locator('.paged-editor__pages');
    await pages.waitFor({ state: 'visible' });
    const box = await pages.boundingBox();
    if (!box) throw new Error('Pages container not found');
    await page.mouse.click(box.x + 120, box.y + 120);
    await page.waitForTimeout(100);

    await page.keyboard.type(' wrng ', { delay: 50 });

    await page.waitForFunction(() => {
      const contentArea =
        document.querySelector('.paged-editor__pages') ||
        document.querySelector('.docx-editor-pages') ||
        document.querySelector('.docx-ai-editor');
      return contentArea && contentArea.textContent?.includes('wrng');
    });

    const coords = await getWordCenter(page, 'wrng');
    expect(coords).not.toBeNull();
    if (!coords) return;

    await page.mouse.click(coords.x, coords.y, { button: 'right' });

    const menu = page.getByRole('menu', { name: 'Text editing menu' });
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu).toContainText('Cut');
    await expect(menu).toContainText('Copy');
    await expect(menu).toContainText('Paste');
    await expect(menu).toContainText('Suggestions');
    await expect(menu).toContainText('Ignore');
    await expect(menu).toContainText('Add to Dictionary');

    const highlightItem = menu.getByRole('menuitem', { name: 'Select All' });
    await highlightItem.hover();
    const highlightBg = await highlightItem.evaluate(
      (el) => window.getComputedStyle(el).backgroundColor
    );
    expect(highlightBg).not.toBe('rgba(0, 0, 0, 0)');

    const suggestionsItem = menu.getByRole('menuitem', { name: 'Suggestions' });
    await suggestionsItem.hover();

    const submenu = page.locator('.docx-text-context-menu-submenu');
    await expect(submenu).toBeVisible({ timeout: 5000 });
    const submenuItems = submenu.locator('.docx-text-context-menu-item');
    const submenuCount = await submenuItems.count();
    expect(submenuCount).toBeGreaterThan(0);
    expect(submenuCount).toBeLessThanOrEqual(5);

    const separators = menu.locator('.docx-text-context-menu-separator');
    await expect(separators.first()).toBeVisible();
    const separatorColor = await separators
      .first()
      .evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(separatorColor).not.toBe('rgba(0, 0, 0, 0)');

    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    const submenuBox = await submenu.boundingBox();
    expect(submenuBox).not.toBeNull();
    if (menuBox) {
      const deltaX = Math.abs(menuBox.x - coords.x);
      const deltaY = Math.abs(menuBox.y - coords.y);
      expect(deltaX).toBeLessThan(20);
      expect(deltaY).toBeLessThan(20);
    }
    if (menuBox && submenuBox) {
      const gap = submenuBox.x - (menuBox.x + menuBox.width);
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(4);
    }
  });

  test('shows unified context menu anywhere in the editor', async ({ page }) => {
    const pages = page.locator('.paged-editor__pages');
    await pages.waitFor({ state: 'visible' });
    const box = await pages.boundingBox();
    if (!box) throw new Error('Pages container not found');

    const clickX = box.x + box.width / 2;
    const clickY = box.y + box.height / 2;
    await page.mouse.click(clickX, clickY, { button: 'right' });

    const menu = page.locator('.docx-text-context-menu');
    await expect(menu).toBeVisible({ timeout: 5000 });
    await expect(menu).toContainText('Select All');
  });
});
