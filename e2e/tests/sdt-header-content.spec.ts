import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * Regression test for SDT (Structured Document Tag) inline content
 * preservation in paged render.
 *
 * The fixture's default header contains two SDT-wrapped paragraphs:
 *   1. A plain run inside `<w:sdt>` (rendered text "SDT-PLAIN")
 *   2. A `<w:fldSimple>` inside `<w:sdt>` (cached text "SDT-FIELD")
 *
 * Before the fix, the parser filtered SimpleField/ComplexField out of
 * InlineSdt.content, so the field text vanished from the rendered
 * header even though the surrounding plain SDT text rendered. After
 * the fix both texts appear.
 */
const FIXTURE = 'fixtures/sdt-header-content.docx';

test('SDT inline content: plain runs and fields inside <w:sdt> both render in the header', async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number="1"]');
  await page.waitForTimeout(1500);

  const page1Header = page.locator('[data-page-number="1"] .layout-page-header');
  const headerText = (await page1Header.textContent()) ?? '';

  expect(headerText).toContain('SDT-PLAIN');
  expect(headerText).toContain('SDT-FIELD');
});
