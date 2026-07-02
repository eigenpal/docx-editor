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

test('Vue: a previously emitted document can be reopened after an external switch', async ({
  page,
}) => {
  await page.goto('http://localhost:5174/?e2e=1&empty=1&controlledDocument=1');
  await page.locator('.docx-editor-vue').waitFor();
  const content = page.locator('.layout-page-content').first();
  const contentBox = await content.boundingBox();
  expect(contentBox).not.toBeNull();
  await page.mouse.click(contentBox!.x + 20, contentBox!.y + 20);
  await page.keyboard.type('abc');

  await page.evaluate(() => {
    const hooks = window as typeof window & {
      __docxVueLastEmittedDocument?: unknown;
      __docxVueCachedDocument?: unknown;
      __docxVueSetControlledDocument?: (next: unknown) => void;
    };
    const cached = hooks.__docxVueLastEmittedDocument;
    if (!cached || !hooks.__docxVueSetControlledDocument) throw new Error('missing Vue E2E hooks');
    hooks.__docxVueCachedDocument = cached;
    const cachedRecord = cached as {
      package: { document: { content: unknown[] } } & Record<string, unknown>;
    } & Record<string, unknown>;
    const external = {
      ...cachedRecord,
      package: {
        ...cachedRecord.package,
        document: {
          ...cachedRecord.package.document,
          content: JSON.parse(JSON.stringify(cachedRecord.package.document.content)),
        },
      },
    };
    const replaceFirstText = (value: unknown): boolean => {
      if (!value || typeof value !== 'object') return false;
      const record = value as Record<string, unknown>;
      if (record.type === 'text' && typeof record.text === 'string') {
        record.text = 'external';
        return true;
      }
      const children =
        value instanceof Map
          ? [...value.values()]
          : Array.isArray(value)
            ? value
            : Object.values(record);
      return children.some(replaceFirstText);
    };
    if (!replaceFirstText(external)) throw new Error('document had no text node');
    hooks.__docxVueSetControlledDocument(external);
  });

  const bodyEditor = page.locator('.docx-editor-vue .ProseMirror').first();
  await expect(bodyEditor).toHaveText('external');
  await page.evaluate(() => {
    const hooks = window as typeof window & {
      __docxVueCachedDocument?: unknown;
      __docxVueSetControlledDocument?: (next: unknown) => void;
    };
    if (!hooks.__docxVueCachedDocument || !hooks.__docxVueSetControlledDocument) {
      throw new Error('missing cached Vue document');
    }
    hooks.__docxVueSetControlledDocument(hooks.__docxVueCachedDocument);
  });
  await expect(bodyEditor).toHaveText('abc');
});
