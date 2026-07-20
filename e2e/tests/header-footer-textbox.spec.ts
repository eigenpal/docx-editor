import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * Regression — text boxes anchored in a header or footer must render in the
 * normal page view, not only in the header/footer inline editor.
 *
 * The parser produces the text box (#318), but the header/footer painter
 * (`paintPage/headerFooter.ts`) only painted paragraph + table blocks —
 * `textBox` (and `image`) blocks were measured, so the header reserved their
 * height, then never drawn. The box showed when you double-clicked into the
 * header to edit it and vanished in the page view.
 */
const FIXTURE = 'fixtures/header-footer-textbox.docx';

test('header and footer text boxes render in the page view', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.loadDocxFile(FIXTURE);
  await page.waitForSelector('[data-page-number="1"]');

  const page1 = page.locator('[data-page-number="1"]');

  // Plain header/footer text and the body text box already worked.
  await expect(page1).toContainText('Plain header text.');
  await expect(page1).toContainText('BODY TEXT BOX');

  // The header/footer text boxes — only visible after the painter fix.
  await expect(page1).toContainText('HEADER TEXT BOX');
  await expect(page1).toContainText('FOOTER TEXT BOX');
});
