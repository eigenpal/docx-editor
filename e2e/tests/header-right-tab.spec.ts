import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/header-right-tab.docx';

/**
 * Regression: this header is a logo, a right (`end`) tab stop, then bold text
 * and a `{project_name}` variable. Word — and the editable header view —
 * keep it on one line because the right tab aligns the text's right edge to
 * the stop. The painter's measurer used to treat every tab as a left tab,
 * measure the line as `stopPx + textWidth`, overflow the content width, and
 * wrap the header onto two lines.
 */
test('header with a right tab stop renders on a single line', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await page.waitForSelector('.layout-page-header .layout-line');

  const firstHeader = page.locator('[data-page-number="1"] .layout-page-header');
  const lineCount = await firstHeader.locator('.layout-line').count();
  expect(lineCount).toBe(1);

  // The header text and the variable share that one line.
  const headerText = await firstHeader.innerText();
  expect(headerText).toContain('CREDIT PROPOSAL');
  expect(headerText).toContain('{project_name}');
});
