import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import * as assertions from '../helpers/assertions';

test.describe('Ribbon - Home actions', () => {
  test('Home > Bold applies formatting', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();
    await editor.newDocument();
    await editor.focus();

    await editor.typeText('Bold text');
    await editor.selectText('Bold');

    const wasBold = await page.evaluate(() => {
      const contentArea =
        document.querySelector('.ProseMirror') ||
        document.querySelector('.docx-editor-pages') ||
        document.querySelector('.docx-ai-editor');
      if (!contentArea) return false;

      const walker = document.createTreeWalker(contentArea, NodeFilter.SHOW_TEXT, null);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent?.includes('Bold')) {
          let element = node.parentElement;
          while (element) {
            const style = window.getComputedStyle(element);
            const fontWeight = style.fontWeight;
            if (fontWeight === 'bold' || parseInt(fontWeight) >= 700) {
              return true;
            }
            if (element.tagName === 'STRONG' || element.tagName === 'B') {
              return true;
            }
            element = element.parentElement;
          }
        }
      }
      return false;
    });

    await page.getByRole('button', { name: 'Bold' }).click();
    await page.waitForTimeout(150);

    const isBold = await page.evaluate(() => {
      const contentArea =
        document.querySelector('.ProseMirror') ||
        document.querySelector('.docx-editor-pages') ||
        document.querySelector('.docx-ai-editor');
      if (!contentArea) return false;

      const walker = document.createTreeWalker(contentArea, NodeFilter.SHOW_TEXT, null);
      let node: Text | null;
      while ((node = walker.nextNode() as Text | null)) {
        if (node.textContent?.includes('Bold')) {
          let element = node.parentElement;
          while (element) {
            const style = window.getComputedStyle(element);
            const fontWeight = style.fontWeight;
            if (fontWeight === 'bold' || parseInt(fontWeight) >= 700) {
              return true;
            }
            if (element.tagName === 'STRONG' || element.tagName === 'B') {
              return true;
            }
            element = element.parentElement;
          }
        }
      }
      return false;
    });

    expect(isBold).toBe(!wasBold);
  });
});
