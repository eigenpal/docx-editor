import { test, expect } from '@playwright/test';

test('Vue: same-object controlled document echoes preserve typing order and undo', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/?e2e=1&empty=1&controlledDocument=1');
  await page.locator('.docx-editor-vue').waitFor();
  const content = page.locator('.layout-page-content').first();
  const contentBox = await content.boundingBox();
  expect(contentBox).not.toBeNull();

  await page.mouse.click(contentBox!.x + 20, contentBox!.y + 20);
  await page.keyboard.type('abc');

  const bodyEditor = page.locator('.docx-editor-vue .ProseMirror').first();
  await expect(bodyEditor).toHaveText('abc');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(bodyEditor).toHaveText('');
});
