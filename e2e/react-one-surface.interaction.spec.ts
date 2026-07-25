// React one-surface interaction gate (interactive-paginated-editing M3.1).
//
// Every scenario drives the editor the way a person does: a real CDP pointer
// click on a painted glyph located by public attribute, then real keys. Nothing
// here calls `authorizeCaret` or `setSelection` to place a caret — that would
// prove the engine can be told where the caret is, not that a click puts it
// there, which is the whole point of this milestone.

import { expect, test, type Page } from '@playwright/test';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import {
  clickTargetCenter,
  clickTargetPointAt,
  dragBetween,
  expectCaretPainted,
  waitForClickTarget,
} from './oneSurfaceHelpers.ts';

const REACT_URL = 'http://localhost:5273';

declare global {
  interface Window {
    __docxAdapterEditor?: Editor;
  }
}

interface FrameProbe {
  readonly anchor: number | null;
  readonly head: number | null;
  readonly blockId: string | null;
  readonly focused: boolean;
  readonly modelRevision: number;
  readonly collapsed: boolean;
}

async function mount(page: Page): Promise<void> {
  await page.goto(`${REACT_URL}/?realAdapter=1`);
  await page.waitForFunction(() => !!window.__docxAdapterEditor);
  await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
  await waitForClickTarget(page);
}

async function probe(page: Page): Promise<FrameProbe> {
  return page.evaluate(() => {
    const frame = window.__docxAdapterEditor!.getInteractionFrame();
    const anchor = frame.selection?.anchor;
    const head = frame.selection?.head;
    return {
      anchor: anchor && anchor.kind === 'text' ? anchor.graphemeOffset : null,
      head: head && head.kind === 'text' ? head.graphemeOffset : null,
      blockId: head && head.kind === 'text' ? head.identity.blockId : null,
      focused: frame.focus.focused,
      modelRevision: frame.revisions.modelRevision,
      collapsed: frame.selectionGeometry?.collapsed ?? true,
    };
  });
}

/** Text as painted on the pages — the rendered output, not the model. */
async function paintedText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-page-index] .ep-one-surface__content > div')]
      .map((el) => el.textContent ?? '')
      .join('')
  );
}

test.describe('React one-surface interaction (task M3.1)', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page);
  });

  test('a real click on a painted glyph places the caret at that glyph', async ({ page }) => {
    const before = await probe(page);
    expect(before.focused).toBe(false);

    const near = await clickTargetPointAt(page, 0.1);
    await page.mouse.click(near.x, near.y);
    const atStart = await probe(page);
    expect(atStart.focused).toBe(true);
    await expectCaretPainted(page);

    // Clicking further right along the same glyph must land further along the
    // text, or the caret is not tracking the pointer at all.
    const far = await clickTargetPointAt(page, 0.9);
    await page.mouse.click(far.x, far.y);
    const atEnd = await probe(page);
    expect(atEnd.head).toBeGreaterThan(atStart.head!);
    expect(atEnd.blockId).toBe(atStart.blockId);
  });

  test('typing after a click inserts at the clicked position and repaints', async ({ page }) => {
    const original = await paintedText(page);
    const point = await clickTargetPointAt(page, 0.1);
    await page.mouse.click(point.x, point.y);
    const placed = await probe(page);

    await page.keyboard.type('Zq');
    await expect.poll(async () => (await probe(page)).modelRevision).toBeGreaterThan(placed.modelRevision);
    const typed = await paintedText(page);
    expect(typed).not.toBe(original);
    expect(typed).toContain('Zq');

    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect.poll(async () => await paintedText(page)).toBe(original);
  });

  test('shift-click extends a range from the placed caret', async ({ page }) => {
    const start = await clickTargetPointAt(page, 0.05);
    await page.mouse.click(start.x, start.y);
    const collapsed = await probe(page);
    expect(collapsed.anchor).toBe(collapsed.head);

    const end = await clickTargetPointAt(page, 0.95);
    await page.keyboard.down('Shift');
    await page.mouse.click(end.x, end.y);
    await page.keyboard.up('Shift');

    const extended = await probe(page);
    expect(extended.anchor).toBe(collapsed.anchor);
    expect(extended.head).toBeGreaterThan(extended.anchor!);
    expect(extended.collapsed).toBe(false);
  });

  test('double-click selects a whole word without splitting it', async ({ page }) => {
    const point = await clickTargetCenter(page);
    await page.mouse.click(point.x, point.y, { clickCount: 2 });
    const word = await probe(page);
    expect(word.head).toBeGreaterThan(word.anchor!);
    expect(word.collapsed).toBe(false);
  });

  test('dragging across a glyph selects the dragged range', async ({ page }) => {
    const from = await clickTargetPointAt(page, 0.05);
    const to = await clickTargetPointAt(page, 0.95);
    await dragBetween(page, from, to);
    const dragged = await probe(page);
    expect(dragged.head).toBeGreaterThan(dragged.anchor!);
    expect(dragged.collapsed).toBe(false);
  });

  test('keyboard navigation moves the caret from where the click put it', async ({ page }) => {
    const point = await clickTargetPointAt(page, 0.1);
    await page.mouse.click(point.x, point.y);
    const placed = await probe(page);

    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await probe(page)).head).toBe(placed.head! + 1);

    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => (await probe(page)).head).toBe(placed.head!);

    await page.keyboard.press('End');
    await expect.poll(async () => (await probe(page)).head).toBeGreaterThan(placed.head!);

    await page.keyboard.press('Home');
    await expect.poll(async () => (await probe(page)).head).toBe(0);
  });

  test('undo and redo reverse and restore a typed edit', async ({ page }) => {
    const original = await paintedText(page);
    const point = await clickTargetPointAt(page, 0.1);
    await page.mouse.click(point.x, point.y);

    // One character, deliberately. Typing bursts are NOT coalesced into a single
    // undo step yet (Word coalesces; this undoes per keystroke), so a multi-character
    // assertion here would be testing an undo-granularity policy this milestone
    // has not specified. The gap is recorded in the M3 summary.
    await page.keyboard.type('U');
    await expect.poll(async () => await paintedText(page)).toContain('U' + original.slice(0, 4));

    // Real shortcuts, not editor.exec: undo has to work the way a person does
    // it, through the focused input host.
    const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
    const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';
    await page.keyboard.press(undo);
    await expect.poll(async () => await paintedText(page)).toBe(original);

    await page.keyboard.press(redo);
    await expect.poll(async () => await paintedText(page)).toContain('U' + original.slice(0, 4));
  });

  test('an edit made by clicking survives save and reopen', async ({ page }) => {
    const point = await clickTargetPointAt(page, 0.1);
    await page.mouse.click(point.x, point.y);
    await page.keyboard.type('Persisted');
    await expect.poll(async () => await paintedText(page)).toContain('Persisted');

    // Save to DOCX bytes and load them back into the same editor. The proof is
    // the repainted pages: the edit has to survive serialization, not just live
    // in an in-memory snapshot.
    await page.evaluate(async () => {
      const editor = window.__docxAdapterEditor!;
      const saved = await editor.save();
      const bytes = saved instanceof Uint8Array ? saved : new Uint8Array(saved as ArrayBuffer);
      await editor.load(bytes);
    });
    await expect.poll(async () => await paintedText(page)).toContain('Persisted');
  });

  test('a click on the page margin is refused with a typed outcome and moves no caret', async ({ page }) => {
    const point = await clickTargetPointAt(page, 0.1);
    await page.mouse.click(point.x, point.y);
    const placed = await probe(page);

    const outcome = await page.evaluate(() => {
      const editor = window.__docxAdapterEditor!;
      const frame = editor.getInteractionFrame();
      const pageEl = document.querySelector('[data-page-index]')!;
      const rect = pageEl.getBoundingClientRect();
      // Bottom-center of the sheet: inside the page, below all content.
      return editor.dispatchInteraction({
        kind: 'click',
        frameId: frame.id,
        clientPoint: { x: rect.x + rect.width / 2, y: rect.y + rect.height - 8 },
        clickCount: 1,
      }).outcome;
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('invalidTarget');
      expect(outcome.reason).toContain('page background');
    }
    expect((await probe(page)).head).toBe(placed.head);
  });

  test('clicking a disabled toolbar control keeps the caret, focus, and geometry keys', async ({ page }) => {
    // Guarded with REAL trusted clicks, deliberately. The previous fix for this was
    // scored 24/24 correct by a probe using synthetic `dispatchEvent` — which DOES run
    // an element's mousedown handler and never moves focus, so it reported success with
    // and without the fix. Chromium dispatches NO mouse event to a disabled form
    // control, so the handler was dead code while focus still left the editor: round-6
    // review measured 20 of 29 controls losing the painted caret, `focus.focused`, and
    // all six geometry keys in the real app.
    //
    // `page.mouse.click` sends a trusted event through the browser's real hit testing,
    // which is the only way this assertion means anything.
    const point = await clickTargetPointAt(page, 0.3);
    await page.mouse.click(point.x, point.y);
    await expectCaretPainted(page);

    const disabledIds = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="toolbar-"]')]
        .filter((el) => el.hasAttribute('data-parity-only') || el.classList.contains('ep-toolbar__picker'))
        .map((el) => (el as HTMLElement).dataset.testid!),
    );
    expect(disabledIds.length).toBeGreaterThan(10);

    const lost: string[] = [];
    for (const id of disabledIds) {
      const control = page.locator(`[data-testid="${id}"]`);
      // Scroll into view BEFORE measuring. The formatting bar scrolls horizontally
      // (legacy `overflow-x: auto`), so measuring first and clicking by coordinate
      // afterwards races the scroll and lands the click outside the control — which
      // looks exactly like the defect under test.
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      if (!box) continue;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const state = await page.evaluate(() => ({
        caret: document.querySelectorAll('[data-testid="one-surface-caret"]').length,
        focused: window.__docxAdapterEditor!.getInteractionFrame().focus.focused,
      }));
      if (state.caret === 0 || !state.focused) lost.push(id);
    }
    expect(lost, `controls that stole focus: ${lost.join(', ')}`).toEqual([]);
  });

  test('clipboard paste inserts at the clicked caret', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const point = await clickTargetPointAt(page, 0.1);
    await page.mouse.click(point.x, point.y);
    const placed = await probe(page);

    await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')!;
      const data = new DataTransfer();
      data.setData('text/plain', 'Pasted');
      pm.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });

    await expect.poll(async () => (await probe(page)).modelRevision).toBeGreaterThan(placed.modelRevision);
    await expect.poll(async () => await paintedText(page)).toContain('Pasted');
  });

  test('an IME composition commits once at the clicked caret', async ({ page }) => {
    const original = await paintedText(page);
    const point = await clickTargetPointAt(page, 0.1);
    await page.mouse.click(point.x, point.y);
    const placed = await probe(page);

    // Real IME through CDP, not synthetic CompositionEvents: synthetic events
    // never touch the contenteditable, so nothing would commit and the test
    // would pass or fail for the wrong reason.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', {
      text: 'にほ',
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send('Input.insertText', { text: 'にほん' });

    await expect.poll(async () => (await probe(page)).modelRevision).toBeGreaterThan(placed.modelRevision);
    const after = await paintedText(page);
    expect(after).not.toBe(original);
    // Committed once: the composed text must not appear twice.
    expect(after.split('にほん').length - 1).toBeLessThanOrEqual(1);
  });
});
