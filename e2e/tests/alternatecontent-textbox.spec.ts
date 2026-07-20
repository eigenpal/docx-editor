import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * Regression — an anchored wps:wsp text box wrapped in
 * <mc:AlternateContent> must render. The wrapper used to hide the
 * <w:drawing> from the text-box enrichment pass.
 */
const FIXTURE = 'fixtures/alternatecontent-textbox.docx';

test('text-box wrapped in mc:AlternateContent renders its shape content', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.loadDocxFile(FIXTURE);
  await page.waitForSelector('[data-page-number="1"]');

  const page1 = page.locator('[data-page-number="1"]');

  await expect(page1).toContainText('Body paragraph hosting the anchored card.');
  // Text inside the wps:wsp under mc:Choice — the assertion this PR unlocks.
  await expect(page1).toContainText('Card Title');
});
