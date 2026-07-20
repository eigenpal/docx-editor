import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/issue-472-floating-textbox.docx';

async function loadFixture(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await page.waitForSelector('.layout-textbox');
  await page.waitForTimeout(1000);
}

test.describe('Issue #472 floating text box', () => {
  test('wraps body text on both sides of an anchored WPS text box', async ({ page }) => {
    await loadFixture(page);

    const geometry = await page.evaluate(() => {
      const textBox = document.querySelector('.layout-textbox') as HTMLElement | null;
      const introParagraph = [...document.querySelectorAll('.layout-paragraph')].find((el) =>
        el.textContent?.includes('Northwind Sample Works')
      ) as HTMLElement | undefined;
      const overview = [...document.querySelectorAll('.layout-paragraph')].find((el) =>
        el.textContent?.includes('Product Overview')
      ) as HTMLElement | undefined;

      if (!textBox || !introParagraph || !overview) return null;

      const boxRect = textBox.getBoundingClientRect();
      const introRect = introParagraph.getBoundingClientRect();
      const overviewRect = overview.getBoundingClientRect();
      const segments = [...introParagraph.querySelectorAll('.layout-line-segment')].map((el) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });

      const overlappingSegments = segments.filter(
        (segment) => segment.bottom > boxRect.top + 2 && segment.top < boxRect.bottom - 2
      );
      const leftSegments = overlappingSegments.filter(
        (segment) => segment.right <= boxRect.left + 2
      );
      const rightSegments = overlappingSegments.filter(
        (segment) => segment.left >= boxRect.right - 2
      );

      return {
        boxTop: boxRect.top,
        boxBottom: boxRect.bottom,
        introTop: introRect.top,
        introBottom: introRect.bottom,
        overviewTop: overviewRect.top,
        leftSegments: leftSegments.length,
        rightSegments: rightSegments.length,
      };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.boxTop).toBeGreaterThan(geometry!.introTop);
    expect(geometry!.boxBottom).toBeLessThan(geometry!.introBottom);
    expect(geometry!.leftSegments).toBeGreaterThan(0);
    expect(geometry!.rightSegments).toBeGreaterThan(0);
    expect(geometry!.overviewTop).toBeGreaterThan(geometry!.introBottom);
  });
});
