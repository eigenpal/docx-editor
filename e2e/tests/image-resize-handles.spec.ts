/**
 * Image resize handles (issue #266).
 *
 * A selected image shows 8 resize handles — 4 corners (keep aspect ratio) and
 * 4 edge midpoints (stretch one dimension). Inserting an image preserves its
 * natural aspect ratio.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMPTY_DOCX = path.join(__dirname, '..', 'fixtures', 'empty.docx');
const TEST_IMAGE = path.join(__dirname, '..', 'fixtures', 'test-image.png');

async function pasteTestImage(page: import('@playwright/test').Page) {
  const base64 = fs.readFileSync(TEST_IMAGE).toString('base64');
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'clipboard.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const target =
      document.querySelector('.ProseMirror') || document.querySelector('[contenteditable="true"]');
    if (!target) throw new Error('Editable target not found');
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: dt });
    target.dispatchEvent(event);
  }, base64);
}

test.describe('Image resize handles (#266)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile(EMPTY_DOCX);
    await editor.focus();
  });

  test('inserting an image preserves its natural aspect ratio', async ({ page }) => {
    const natural = await page.evaluate(
      (src) =>
        new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.src = src;
        }),
      'data:image/png;base64,' + fs.readFileSync(TEST_IMAGE).toString('base64')
    );

    await pasteTestImage(page);
    const img = page.locator('.layout-run-image').first();
    await expect(img).toBeVisible({ timeout: 10000 });

    const box = await img.boundingBox();
    const naturalRatio = natural.w / natural.h;
    const renderedRatio = box!.width / box!.height;
    expect(renderedRatio).toBeCloseTo(naturalRatio, 1);
  });

  test('a selected image shows 8 handles (4 corners + 4 edges)', async ({ page }) => {
    await pasteTestImage(page);
    const img = page.locator('.layout-run-image').first();
    await expect(img).toBeVisible({ timeout: 10000 });

    // Click selects the image (NodeSelection) → the overlay paints handles.
    await img.click();

    const handles = page.locator('.image-selection-overlay [data-handle]');
    await expect.poll(() => handles.count()).toBe(8);

    const positions = await handles.evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-handle')).sort()
    );
    expect(positions).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
  });
});
