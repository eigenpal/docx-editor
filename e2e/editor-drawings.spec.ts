// Task 17 — one browser acceptance flow for typed drawings authoring chrome.
//
// Opens `image-layout-modes-demo.docx`, selects the square-wrap anchor, edits wrap/alt text,
// moves and resizes by keyboard, undo/redo, then save/reopen via download + file input.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page.ts';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DEMO_URL = 'http://localhost:5273/?fixture=image-layout-modes-demo.docx&drawingsE2e=1';
const SCROLLER = '.docx-editor__scroll-container';
const NUDGE_PT = 1;
const EMU_PER_POINT = 12700;

interface OverlayMetrics {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly widthEmu: number;
  readonly heightEmu: number;
}

interface SelectedImageSnapshot {
  readonly wrap: string;
  readonly description: string | null;
  readonly widthEmu: number;
  readonly heightEmu: number;
  readonly verticalEmu: number | null;
}

test.beforeEach(async ({ page }) => {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });
});

async function settle(page: Page): Promise<void> {
  await page
    .locator(SCROLLER)
    .first()
    .evaluate((el) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true })));
  await page.waitForTimeout(250);
}

async function materializeDocument(page: Page): Promise<void> {
  const scroller = page.locator(SCROLLER).first();
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  await settle(page);
  for (let i = 0; i < 40; i++) {
    const atEnd = await scroller.evaluate((el) => {
      const next = el.scrollTop + el.clientHeight * 0.9;
      if (next >= el.scrollHeight - el.clientHeight - 1) return true;
      el.scrollTop = next;
      return false;
    });
    await settle(page);
    if (atEnd) break;
  }
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  await settle(page);
}

async function bridgeOverlay(page: Page): Promise<OverlayMetrics> {
  const metrics = await page.evaluate(() => window.__docxDrawingsE2e!.overlayTarget());
  if (!metrics) throw new Error('missing overlay target');
  return metrics;
}

async function bridgeSelectedImage(page: Page): Promise<SelectedImageSnapshot> {
  const image = await page.evaluate(() => window.__docxDrawingsE2e!.selectedImage());
  if (!image) throw new Error('missing selected image');
  return image;
}

async function selectSquareWrapAnchor(page: Page): Promise<Locator> {
  await page.waitForFunction(() => !!window.__docxDrawingsE2e);
  await page.evaluate(() => window.__docxDrawingsE2e!.selectDrawing(2, 0));
  await settle(page);
  await expect(page.locator('[data-slot="image.wrap"]')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.docx-image-selection-overlay')).toHaveCount(1, { timeout: 10_000 });
  const selected = await bridgeSelectedImage(page);
  expect(selected.wrap).toBe('square');
  return page.locator('.docx-image-selection-overlay');
}

test('image layout modes demo — wrap, move, alt text, resize, undo/redo, save/reopen', async ({
  page,
}) => {
  await materializeDocument(page);
  const beforeCount = await page.evaluate(() => window.__docxDrawingsE2e!.paintedDrawingCount());
  expect(beforeCount).toBe(3);

  const overlay = await selectSquareWrapAnchor(page);
  const wrapTrigger = page.locator('[data-slot="image.wrap"]');
  await expect(wrapTrigger).toBeEnabled();

  const beforeOverlay = await bridgeOverlay(page);
  const beforeImage = await bridgeSelectedImage(page);

  await wrapTrigger.click();
  await page.getByRole('menuitemradio', { name: 'Top and Bottom', exact: true }).click();
  await expect(wrapTrigger).toHaveAttribute('title', /Top and Bottom/i);
  expect((await bridgeSelectedImage(page)).wrap).toBe('topAndBottom');

  const afterWrapOverlay = await bridgeOverlay(page);

  await overlay.focus();
  await page.keyboard.press('ArrowDown');
  const afterMove = await bridgeOverlay(page);
  const afterMoveImage = await bridgeSelectedImage(page);
  expect(afterMove.y - afterWrapOverlay.y).toBeCloseTo(NUDGE_PT, 3);

  const altTrigger = page.locator('[data-slot="image.altText"]');
  await expect(altTrigger).toBeEnabled();
  await altTrigger.click();
  const textarea = page.locator('.docx-toolbar__alt-text-panel textarea');
  await expect(textarea).toBeVisible();
  const altText = 'Editor acceptance alt text';
  await textarea.fill(altText);
  await page.locator('.docx-toolbar__alt-text-panel button.docx-dialog__button--primary').click();
  await expect(page.getByRole('img', { name: altText })).toHaveCount(1, { timeout: 10_000 });
  expect((await bridgeSelectedImage(page)).description).toBe(altText);

  await overlay.focus();
  await page.keyboard.press('Alt+ArrowRight');
  const afterResize = await bridgeSelectedImage(page);
  expect(afterResize.widthEmu - beforeImage.widthEmu).toBe(EMU_PER_POINT);

  const undo = page.locator('[data-slot="history.undo"]');
  await expect(undo).toBeEnabled({ timeout: 10_000 });

  await undo.click();
  await settle(page);
  expect((await bridgeSelectedImage(page)).widthEmu).toBe(afterResize.widthEmu - EMU_PER_POINT);

  await undo.click();
  await settle(page);
  expect((await bridgeSelectedImage(page)).description).not.toBe(altText);

  await undo.click();
  await settle(page);
  const afterUndoMove = await bridgeOverlay(page);
  expect(afterUndoMove.y).toBeCloseTo(afterWrapOverlay.y, 3);

  await undo.click();
  await settle(page);
  await page.evaluate(() => window.__docxDrawingsE2e!.selectDrawing(2, 0));
  await settle(page);
  expect((await bridgeSelectedImage(page)).wrap).toBe('square');
  await expect(wrapTrigger).toHaveAttribute('title', /Square/i);

  const redo = page.locator('[data-slot="history.redo"]');
  await expect(redo).toBeEnabled();
  await redo.click();
  await settle(page);
  expect((await bridgeSelectedImage(page)).wrap).toBe('topAndBottom');
  await redo.click();
  await settle(page);
  const afterRedoMove = await bridgeOverlay(page);
  expect(afterRedoMove.y - afterWrapOverlay.y).toBeCloseTo(NUDGE_PT, 3);
  await redo.click();
  await settle(page);
  expect((await bridgeSelectedImage(page)).description).toBe(altText);
  await redo.click();
  await settle(page);
  expect((await bridgeSelectedImage(page)).widthEmu).toBe(afterResize.widthEmu);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save', exact: true }).click(),
  ]);
  const tmpDir = mkdtempSync(join(tmpdir(), 'docx-drawings-e2e-'));
  const savedPath = join(tmpDir, 'saved.docx');
  await download.saveAs(savedPath);
  const savedBytes = readFileSync(savedPath);
  expect(savedBytes.byteLength).toBeGreaterThan(1000);

  await page
    .locator('input[type="file"][accept*=".docx"]')
    .first()
    .setInputFiles(savedPath);
  await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });
  await settle(page);
  await materializeDocument(page);

  await page.evaluate(() => window.__docxDrawingsE2e!.selectDrawing(2, 0));
  await settle(page);

  expect(await page.evaluate(() => window.__docxDrawingsE2e!.paintedDrawingCount())).toBe(3);
  expect((await bridgeSelectedImage(page)).wrap).toBe('topAndBottom');
  expect((await bridgeSelectedImage(page)).description).toBe(altText);
  expect((await bridgeSelectedImage(page)).widthEmu).toBe(afterResize.widthEmu);
  expect((await bridgeSelectedImage(page)).verticalEmu).toBe(afterMoveImage.verticalEmu);
  await expect(wrapTrigger).toHaveAttribute('title', /Top and Bottom/i);

  const screenshotDir = join(process.cwd(), '../screenshots/typed-drawings-word-comparison');
  mkdirSync(screenshotDir, { recursive: true });
  writeFileSync(
    join(screenshotDir, 'editor-image-layout-modes-demo.txt'),
    'Editor output capture (NOT Word reference). Top-and-bottom wrap, keyboard move/resize, alt text persisted after save/reopen via file input.\n'
  );
});
