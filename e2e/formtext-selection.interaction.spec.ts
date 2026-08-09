// Browser-level selection/input regression for editable FORMTEXT results.
//
// A native caret can move before the queued `selectionchange` reaches the model. These tests
// hold that report back deliberately, then use real pointer and keyboard input to prove the
// command synchronizes from the browser instead of editing the stale model range.

import { expect, test, type Page } from '@playwright/test';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { DocxEditorE2EHook } from '../examples/vite/src/test-harness/table-editing-e2e-hook.ts';

const DEMO_URL = 'http://localhost:5273/?e2e=1&fixture=formtext-selection.docx';
const PARAGRAPH_TEXT = 'Address: Street, trailing text';
const FIELD = '[data-field-atom="form"]';

declare global {
  interface Window {
    __DOCX_EDITOR_E2E__?: DocxEditorE2EHook;
  }
}

async function waitForEditor(page: Page): Promise<void> {
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__DOCX_EDITOR_E2E__?.ready());
  await page.waitForSelector('.docx-page');
  // Let the document fonts settle so the pointer geometry stays fixed during the gesture.
  await page.waitForTimeout(250);
}

async function placeStaleModelCaretAtParagraphEnd(page: Page): Promise<void> {
  const paragraph = page.locator('.docx-paragraph-fragment').filter({ hasText: PARAGRAPH_TEXT });
  const box = await paragraph.boundingBox();
  if (!box) throw new Error('FORMTEXT regression paragraph is not painted');
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const editor = window.__DOCX_EDITOR_E2E__!.getEditor() as DocxEditorInstance;
        return editor.surface!.state().selection.head.offset;
      })
    )
    .toBe(PARAGRAPH_TEXT.length);
}

async function delayNativeSelectionReport(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pages = document.querySelector('.docx-pages');
    if (!pages) throw new Error('pages layer is not mounted');
    // Keep the browser's native selection newer than the model, matching the queued-event
    // window that caused Backspace to use the previous paragraph-end selection.
    window.addEventListener('selectionchange', (event) => event.stopPropagation(), true);
    pages.addEventListener('pointerdown', (event) => event.stopImmediatePropagation(), true);
  });
}

async function selectionSnapshot(page: Page): Promise<{
  readonly modelOffset: number;
  readonly nativeOffset: number;
  readonly nativeText: string;
  readonly selectedText: string;
}> {
  return page.evaluate(() => {
    const editor = window.__DOCX_EDITOR_E2E__!.getEditor() as DocxEditorInstance;
    const native = document.getSelection();
    return {
      modelOffset: editor.surface!.state().selection.head.offset,
      nativeOffset: native?.anchorOffset ?? -1,
      nativeText: native?.anchorNode?.textContent ?? '',
      selectedText: native?.toString() ?? '',
    };
  });
}

test.beforeEach(async ({ page }) => {
  await waitForEditor(page);
  await placeStaleModelCaretAtParagraphEnd(page);
  await delayNativeSelectionReport(page);
});

test('clicking inside a FORMTEXT result makes Backspace delete beside that caret', async ({
  page,
}) => {
  const field = page.locator(FIELD).first();
  const box = await field.boundingBox();
  if (!box) throw new Error('FORMTEXT result is not painted');

  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height / 2);
  const before = await selectionSnapshot(page);
  expect(before.nativeText).toBe('Street');
  expect(before.nativeOffset).toBeGreaterThan(0);
  expect(before.nativeOffset).toBeLessThan('Street'.length);
  // Discriminating precondition: the queued report has not updated the command selection.
  expect(before.modelOffset).toBe(PARAGRAPH_TEXT.length);

  const expected = 'Street'.slice(0, before.nativeOffset - 1) + 'Street'.slice(before.nativeOffset);
  await page.keyboard.press('Backspace');

  await expect(page.locator(FIELD).first()).toHaveText(expected);
  await expect(page.locator('.docx-paragraph-fragment').first()).toContainText(', trailing text');
});

test('a native range inside a FORMTEXT result is preserved for Backspace', async ({ page }) => {
  const field = page.locator(FIELD).first();
  const box = await field.boundingBox();
  if (!box) throw new Error('FORMTEXT result is not painted');

  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const before = await selectionSnapshot(page);
  expect(before.selectedText).toBe('tree');
  expect(before.modelOffset).toBe(PARAGRAPH_TEXT.length);

  await page.keyboard.press('Backspace');

  await expect(page.locator(FIELD).first()).toHaveText('St');
  await expect(page.locator('.docx-paragraph-fragment').first()).toHaveText(
    'Address: St, trailing text'
  );
});
