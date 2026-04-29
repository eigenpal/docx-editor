/**
 * Clipboard image paste regression test
 *
 * Ensures that pasting a clipboard image inserts a single image node
 * even when the clipboard provides duplicate image entries.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EMPTY_DOCX = path.join(__dirname, '..', 'fixtures', 'empty.docx');
const TEST_IMAGE = path.join(__dirname, '..', 'fixtures', 'test-image.png');

test.describe('Clipboard Image Paste', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile(EMPTY_DOCX);
  });

  test('pasting a clipboard image inserts only one image', async ({ page }) => {
    await editor.focus();

    const base64 = fs.readFileSync(TEST_IMAGE).toString('base64');
    const images = page.locator('.paged-editor__pages img');
    const initialCount = await images.count();

    const counts = await page.evaluate(
      (payload) => {
        const bytes = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0));
        const fileA = new File([bytes], 'clipboard.png', {
          type: 'image/png',
          lastModified: 111,
        });
        const fileB = new File([bytes], 'clipboard.bmp', {
          type: 'image/bmp',
          lastModified: 222,
        });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(fileA);
        dataTransfer.items.add(fileB);

        const target =
          document.querySelector('.ProseMirror') ||
          document.querySelector('[contenteditable=\"true\"]');
        if (!target) {
          throw new Error('Editable target not found');
        }

        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: dataTransfer });
        target.dispatchEvent(event);
        return { files: dataTransfer.files.length, items: dataTransfer.items.length };
      },
      { base64 }
    );

    expect(counts.files).toBe(2);
    expect(counts.items).toBe(2);

    await expect(images).toHaveCount(initialCount + 1);
  });
});
