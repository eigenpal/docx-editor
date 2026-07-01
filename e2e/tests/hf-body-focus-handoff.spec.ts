import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

/**
 * The body↔header/footer focus hand-off (tasks §10a.3).
 *
 * There are several ProseMirror editors on the page — one for the body, one per
 * header/footer part — and all of them are off-screen. Exactly one may hold
 * focus, because a keystroke goes to whichever one does, and the user can only
 * see the caret we paint for it.
 *
 * `hf-click-and-type.spec.ts` already covers going *in*: click a header, type,
 * the text lands in the header. Nothing covered coming back *out*. That is the
 * direction that can fail silently: the header keeps focus, the user clicks into
 * the body, sees the caret move there — and their next sentence is appended to
 * the header. The document is corrupted somewhere they are not looking.
 *
 * So: type in the header, click into the body, type again, and assert the second
 * string landed in the body and NOT in the header.
 */
test('leaving a header returns focus to the body, and the next keystroke lands there', async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page
    .locator('input[type="file"][accept=".docx"]')
    .setInputFiles('e2e/fixtures/header-with-table.docx');
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
    timeout: 15000,
  });

  // --- Into the header.
  await page.locator('.layout-page-header').first().dblclick();
  await expect(page.locator('.hf-inline-editor')).toHaveCount(1);

  await page.locator('.layout-page-header .layout-table-cell span[data-doc-from]').first().click();
  await page.keyboard.type('HEADERMARK');

  await expect(page.locator('.layout-page-header').first()).toContainText('HEADERMARK');

  // --- Back out to the body.
  const bodySpan = page.locator('.layout-page-content span[data-doc-from]').first();
  await bodySpan.click();

  // The header edit mode must close — while it is open the header still owns
  // editing, and the click has done nothing but move a caret the user can see
  // but cannot type into.
  await expect(page.locator('.hf-inline-editor')).toHaveCount(0);

  await page.keyboard.type('BODYMARK');

  // The second string must be in the body...
  await expect(page.locator('.layout-page-content').first()).toContainText('BODYMARK');

  // ...and must NOT have been appended to the header, which is the failure this
  // test exists to catch. The header keeps its own text.
  const headerText = await page.locator('.layout-page-header').first().textContent();
  expect(headerText).toContain('HEADERMARK');
  expect(headerText).not.toContain('BODYMARK');
});
