/**
 * Vue counterpart of the image resize handles test (issue #266).
 *
 * A selected image shows 8 resize handles (4 corners + 4 edge midpoints) and
 * inserting an image preserves its natural aspect ratio. The Vue overlay root
 * is `.image-overlay` (React uses `.image-selection-overlay`).
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMPTY_DOCX = path.join(__dirname, '..', '..', 'fixtures', 'empty.docx');
const TEST_IMAGE = path.join(__dirname, '..', '..', 'fixtures', 'test-image.png');

async function loadEmpty(page: import('@playwright/test').Page) {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();
  await page.waitForSelector('[data-page-number]', { timeout: 15000 });
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(EMPTY_DOCX);
  await page.waitForTimeout(500);
}

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

test('Vue: inserting an image preserves its natural aspect ratio (#266)', async ({ page }) => {
  await loadEmpty(page);

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
  expect(box!.width / box!.height).toBeCloseTo(natural.w / natural.h, 1);
});

test('Vue: a selected image shows 8 handles (4 corners + 4 edges) (#266)', async ({ page }) => {
  await loadEmpty(page);
  await pasteTestImage(page);
  const img = page.locator('.layout-run-image').first();
  await expect(img).toBeVisible({ timeout: 10000 });

  await img.click();

  const handles = page.locator('.image-overlay [data-handle]');
  await expect.poll(() => handles.count()).toBe(8);
  const positions = await handles.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-handle')).sort()
  );
  expect(positions).toEqual(['e', 'n', 'ne', 'nw', 's', 'se', 'sw', 'w']);
});
