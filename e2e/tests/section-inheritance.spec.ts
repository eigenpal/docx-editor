import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * Regression test for OOXML section inheritance (ECMA-376 §17.6).
 *
 * The fixture places its w:headerReference / w:footerReference / w:titlePg
 * on an early in-body sectPr and leaves the body-level sectPr free of any
 * header/footer refs. Before the parser learned section inheritance the
 * editor saw no header on any page because it reads finalSectionProperties
 * only.
 *
 * Headers/footers carry plain text marker strings so the spec asserts on
 * text content rather than dragging in image data.
 */
const FIXTURE = 'fixtures/section-inheritance-header-footer.docx';

test('section inheritance: page 1 picks up first-page header/footer and titlePg from an earlier section', async ({
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
  const page1Footer = page.locator('[data-page-number="1"] .layout-page-footer');

  const headerText = (await page1Header.textContent()) ?? '';
  const footerText = (await page1Footer.textContent()) ?? '';

  // First-page header/footer inherited from section 1
  expect(headerText).toContain('FIRST-PAGE-HEADER');
  expect(footerText).toContain('FIRST-PAGE-FOOTER');

  // titlePg inherited: default content must NOT appear on page 1
  expect(headerText).not.toContain('DEFAULT-HEADER');
  expect(footerText).not.toContain('DEFAULT-FOOTER');
});
