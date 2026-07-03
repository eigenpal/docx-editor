import { expect, test } from '@playwright/test';

/**
 * Vue parity for e2e/tests/hf-body-focus-handoff.spec.ts. A body click must
 * close header editing and focus the hidden body EditorView before typing.
 */
test('Vue: leaving a header returns focus and typing to the body', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles('e2e/fixtures/header-with-table.docx');
  await page.waitForSelector('[data-page-number]');
  await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
    timeout: 15000,
  });

  await page.locator('.layout-page-header').first().dblclick();
  await expect(page.locator('.hf-editor')).toHaveCount(1);

  await page.locator('.layout-page-header .layout-table-cell span[data-doc-from]').first().click();
  await page.keyboard.type('VUEHEADERMARK');
  await expect(page.locator('.layout-page-header').first()).toContainText('VUEHEADERMARK');

  const bodySpan = page.locator('.layout-page-content span[data-doc-from]').first();
  const bodyBox = await bodySpan.boundingBox();
  expect(bodyBox).not.toBeNull();
  await page.mouse.click(bodyBox!.x + bodyBox!.width / 2, bodyBox!.y + bodyBox!.height / 2);

  await expect(page.locator('.hf-editor')).toHaveCount(0);
  await page.keyboard.type('VUEBODYMARK');

  await expect(page.locator('.layout-page-content').first()).toContainText('VUEBODYMARK');
  const headerText = await page.locator('.layout-page-header').first().textContent();
  expect(headerText).toContain('VUEHEADERMARK');
  expect(headerText).not.toContain('VUEBODYMARK');
});
