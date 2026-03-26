import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

async function getParagraphBorder(page: import('@playwright/test').Page, text: string) {
  return await page.evaluate((searchText) => {
    const paragraphs = Array.from(document.querySelectorAll('p'));
    const target = paragraphs.find((p) => p.textContent?.includes(searchText));
    if (!target) return null;
    const style = window.getComputedStyle(target);
    return {
      style: style.borderBottomStyle,
      width: style.borderBottomWidth,
      color: style.borderBottomColor,
    };
  }, text);
}

test.describe('Ribbon - Paragraph Borders', () => {
  test('Home > Borders toggles paragraph bottom border', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();
    await editor.focus();

    await editor.selectAll();
    await editor.typeText('Border Line');
    await editor.selectAll();

    await editor.clickRibbonButton('borders');

    const withBorder = await getParagraphBorder(page, 'Border Line');
    expect(withBorder).not.toBeNull();
    expect(withBorder?.style).not.toBe('none');
    expect(withBorder?.width).not.toBe('0px');

    await editor.clickRibbonButton('borders');

    const withoutBorder = await getParagraphBorder(page, 'Border Line');
    expect(withoutBorder).not.toBeNull();
    expect(withoutBorder?.style === 'none' || withoutBorder?.width === '0px').toBe(true);
  });
});
