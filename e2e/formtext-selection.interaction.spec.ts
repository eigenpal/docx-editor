// Browser-level selection/input regression for editable FORMTEXT results.
//
// Real pointer and keyboard input cover both selection lanes that meet at a FORMTEXT result:
// layout-owned hit-testing through justified NBSP text, and native selection moving before the
// queued `selectionchange` reaches the model.

import { expect, test, type Page } from '@playwright/test';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import type { DocxEditorE2EHook } from '../examples/vite/src/test-harness/table-editing-e2e-hook.ts';

const DEMO_URL = 'http://localhost:5273/?e2e=1&fixture=formtext-selection.docx';
const PARAGRAPH_TEXT =
  'reg. no Country, having its principal office at Street, Post/area code, City, Country, (the CompanyNameThatIsTooWideForTheRemainingLine continues with trailing words)';
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
  // Wait for actual font readiness rather than an OS-dependent delay.
  await page.waitForFunction(() => window.__DOCX_EDITOR_E2E__?.fontMeasurer() === 'shaped');
}

async function placeStaleModelCaretAtParagraphEnd(page: Page): Promise<void> {
  // This is setup, not the pointer gesture under test. Establish the stale caret
  // explicitly so platform font metrics cannot place it short of the final glyph.
  await page.evaluate((offset) => {
    const editor = window.__DOCX_EDITOR_E2E__!.getEditor() as DocxEditorInstance;
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    const position = { paragraphId, offset };
    surface.setSelection({ anchor: position, head: position });
    document.querySelector<HTMLElement>('.docx-pages')!.focus();
  }, PARAGRAPH_TEXT.length);
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

function streetField(page: Page) {
  return page.locator(FIELD).filter({ hasText: 'Street' }).first();
}

function fieldAtStart(page: Page, start: number) {
  return page.locator(`${FIELD}[data-start="${start}"]`).first();
}

async function clickAtRightEdgeOfStreetRange(
  page: Page,
  start: number,
  end: number
): Promise<void> {
  const field = streetField(page);
  const point = await field.evaluate(
    (element, rangeOffsets) => {
      const text = element.firstChild;
      if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Street text node is missing');
      const range = document.createRange();
      range.setStart(text, rangeOffsets.start);
      range.setEnd(text, rangeOffsets.end);
      const box = range.getBoundingClientRect();
      return { x: box.right - 0.1, y: box.top + box.height / 2 };
    },
    { start, end }
  );
  await page.mouse.click(point.x, point.y);
}

test.beforeEach(async ({ page }) => {
  await waitForEditor(page);
  await placeStaleModelCaretAtParagraphEnd(page);
});

test('clicking a justified NBSP form field selects and deletes the whole result like Word', async ({
  page,
}) => {
  const field = streetField(page);
  const fieldStart = Number(await field.getAttribute('data-start'));
  await clickAtRightEdgeOfStreetRange(page, 3, 4);

  const afterClick = await selectionSnapshot(page);
  expect(afterClick.nativeText).toBe('Street');
  expect(afterClick.selectedText).toBe('Street');
  expect(afterClick.modelOffset).toBe(fieldStart + 'Street'.length);

  await page.keyboard.press('Backspace');

  await expect(streetField(page)).toHaveCount(0);
  await expect(
    page.locator('.docx-paragraph-fragment').filter({ hasText: 'Post/area code' })
  ).toContainText('at , Post/area code');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(fieldAtStart(page, fieldStart)).toHaveText('Street');
});

test('a native caret inside a FORMTEXT result overrides the stale model for Backspace', async ({
  page,
}) => {
  await delayNativeSelectionReport(page);
  const field = streetField(page);
  const fieldStart = Number(await field.getAttribute('data-start'));
  const box = await field.boundingBox();
  if (!box) throw new Error('FORMTEXT result is not painted');

  // Inspect the browser caret after pointerdown, before pointerup/click selects
  // the whole field. Keep selectionchange delayed until the real Backspace key.
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
  await page.mouse.down();
  const before = await selectionSnapshot(page);
  expect(before.nativeText).toBe('Street');
  expect(before.nativeOffset).toBeGreaterThan(0);
  expect(before.nativeOffset).toBeLessThan('Street'.length);
  // Discriminating precondition: the queued report has not updated the command selection.
  expect(before.modelOffset).toBe(PARAGRAPH_TEXT.length);

  const expected = 'Street'.slice(0, before.nativeOffset - 1) + 'Street'.slice(before.nativeOffset);
  await page.keyboard.press('Backspace');
  await page.mouse.up();

  await expect(fieldAtStart(page, fieldStart)).toHaveText(expected);
  await expect(page.locator('.docx-paragraph-fragment').first()).toContainText(', Post/area code');
});

test('a native range inside a FORMTEXT result is preserved for Backspace', async ({ page }) => {
  await delayNativeSelectionReport(page);
  const field = streetField(page);
  const fieldStart = Number(await field.getAttribute('data-start'));
  const box = await field.boundingBox();
  if (!box) throw new Error('FORMTEXT result is not painted');
  // Pointerdown focuses the actual native editing host before the queued-range race.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // Deliberately make native selection newer than the model. Native dragging
  // with the editor's pointer handler disabled differs across Chromium platforms;
  // the Selection API establishes the exact race this Backspace test exercises.
  await field.evaluate((element) => {
    const text = element.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Street text node is missing');
    document.getSelection()!.setBaseAndExtent(text, 1, text, 5);
  });

  const before = await selectionSnapshot(page);
  expect(before.selectedText).toBe('tree');
  expect(before.modelOffset).toBe(PARAGRAPH_TEXT.length);

  await page.keyboard.press('Backspace');
  await page.mouse.up();

  await expect(fieldAtStart(page, fieldStart)).toHaveText('St');
  await expect(page.locator('.docx-paragraph-fragment').first()).toContainText(
    'at St, Post/area code'
  );
});
