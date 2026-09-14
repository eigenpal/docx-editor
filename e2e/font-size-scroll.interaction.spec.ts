import { expect, test, type Page } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page';

// Issue #664: restoring focus to the document-sized pages layer must not let the
// browser scroll its start into view. Exercise real browser focus with a caret and a range.

async function selectionState(page: Page) {
  return page.evaluate(() => {
    const range = document.getSelection()!;
    return {
      text: range.toString(),
      collapsed: range.isCollapsed,
      paragraph: range.anchorNode?.parentElement
        ?.closest('[data-paragraph-id]')
        ?.getAttribute('data-paragraph-id'),
    };
  });
}

for (const [framework, port] of [
  ['React', 5273],
  ['Vue', 5274],
] as const) {
  for (const action of ['preset', 'typed', 'escape'] as const) {
    for (const selection of ['caret', 'range'] as const) {
      test(`${framework}: font size ${action} with ${selection} preserves scroll and editing focus`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 1440, height: 778 });
        await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
        await page.waitForSelector(PAINTED_PAGE);
        const scroller = page.locator('.docx-editor__scroll-container').first();
        await scroller.evaluate((element) => {
          element.scrollTop = 3000;
        });
        await page.waitForTimeout(500);
        const point = await page.evaluate(() => {
          const paragraph = [
            ...document.querySelectorAll('.docx-line[data-paragraph-id^="/word/document.xml#"]'),
          ].find((node) => {
            const rect = node.getBoundingClientRect();
            return (
              rect.top > 180 &&
              rect.bottom < innerHeight - 80 &&
              rect.width > 100 &&
              (node.textContent ?? '').length > 20
            );
          });
          if (!paragraph) return null;
          const rect = paragraph.getBoundingClientRect();
          return { x: rect.x + 60, y: rect.y + rect.height / 2 };
        });
        expect(point).not.toBeNull();
        await page.mouse.click(point!.x, point!.y, { clickCount: selection === 'range' ? 2 : 1 });
        const caretBefore = await selectionState(page);
        expect(caretBefore.paragraph).toBeTruthy();
        expect(caretBefore.collapsed).toBe(selection === 'caret');
        const before = await scroller.evaluate((element) => element.scrollTop);
        expect(before).toBeGreaterThan(2000);
        const size = page.getByRole('combobox', { name: 'Font size', exact: true });
        await size.click();
        if (action === 'preset') {
          await page.getByRole('option', { name: '24', exact: true }).click();
        } else if (action === 'typed') {
          await size.fill('24');
          await size.press('Enter');
        } else {
          await size.press('Escape');
        }
        await expect(page.locator('.docx-pages').first()).toBeFocused();
        await page.waitForTimeout(300);
        expect(await scroller.evaluate((element) => element.scrollTop)).toBe(before);
        if (action !== 'escape') await expect(size).toHaveValue('24');
        expect(await selectionState(page)).toEqual(caretBefore);
        // The next keystroke reaches the original paragraph without another click.
        await page.keyboard.type('FONTSCROLL');
        await expect(
          page.locator('.docx-paragraph-fragment').filter({ hasText: 'FONTSCROLL' })
        ).toHaveAttribute('data-paragraph-id', caretBefore.paragraph!);
      });
    }
  }
}
