import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * Regression test for tab + non-text content preservation inside <w:hyperlink>.
 *
 * The fixture has a single TOC1-styled paragraph:
 *   <w:hyperlink>
 *     1 [tab] Introduction [tab] 5
 *   </w:hyperlink>
 *
 * TOC1 declares a right-aligned dot-leader tab at 9628 twips so a working
 * pipeline renders "1   Introduction ........... 5". On `main` the converter
 * dropped tab runs inside hyperlinks, collapsing the line to "1Introduction5".
 */
const FIXTURE = 'fixtures/toc-hyperlink-tabs.docx';

test('hyperlink-wrapped TOC entry preserves tab runs between number, title, and page', async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.loadDocxFile(FIXTURE);
  await page.waitForSelector('[data-page-number="1"]');

  const page1 = page.locator('[data-page-number="1"]');

  // All three text fragments survive.
  const bodyText = (await page1.textContent()) ?? '';
  expect(bodyText).toContain('1');
  expect(bodyText).toContain('Introduction');
  expect(bodyText).toContain('5');

  // Both tab runs survive the hyperlink boundary. The layout-painter emits
  // tabs as inline-block elements with class layout-run-tab.
  const tabCount = await page1.locator('.layout-run-tab').count();
  expect(tabCount).toBeGreaterThanOrEqual(2);

  // TOC compat: Word renders TOC entries in the TOCx paragraph color (black),
  // suppressing the Hyperlink character style's blue + underline. Eigenpal
  // should match — the anchor on the visible page must not have blue text
  // nor any text-decoration underline.
  const anchorColor = await page1
    .locator('a')
    .first()
    .evaluate((a) => {
      return getComputedStyle(a as HTMLElement).color;
    });
  // Not pure blue (rgb(0, 0, 255)) and not Word-default link blue (#0563c1).
  expect(anchorColor).not.toBe('rgb(0, 0, 255)');
  expect(anchorColor).not.toBe('rgb(5, 99, 193)');

  const anchorDecoration = await page1
    .locator('a')
    .first()
    .evaluate((a) => {
      return getComputedStyle(a as HTMLElement).textDecorationLine;
    });
  expect(anchorDecoration).toBe('none');
});
