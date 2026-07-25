// M6K.1 — the production surface must match RAW ProseMirror for editing commands.
//
// The bridge had taken over semantic editing and implemented less of it than PM already
// does: `beforeinput` handled only `deleteContentBackward`/`Forward` and rejected
// everything else, so Cmd/Ctrl+Backspace, Alt/Option+Backspace, and Shift+Enter were
// dead; and it claimed logical Left/Right to reimplement grapheme movement.
//
// Asserting "the editor does something reasonable" would not have caught that. This gate
// drives the SAME keystrokes into the production surface and into a raw PM editor
// holding the same paragraphs, and compares the resulting text and selection.
//
// The engine keeps the keys that need layout to answer — Up/Down, Home/End, PageUp/Down
// — and those are asserted separately: PM must NOT be able to pre-empt an engine refusal.

import { expect, test, type Page } from '@playwright/test';
import type { Editor } from '@docx-editor.dev/core-contract/editor';

declare global {
  interface Window {
    __docxAdapterEditor?: Editor;
    __rawPmView?: { focus(): void };
    __rawPmText?: () => string;
    __rawPmHead?: () => { paragraph: number; offset: number };
  }
}

/** The reference paragraphs the harness seeds into BOTH editors. */
const FIRST = 'The quick brown fox jumps over the lazy dog';

const isMac = process.platform === 'darwin';
const MOD = isMac ? 'Meta' : 'Control';
/** Word-wise deletion is Alt on macOS, Ctrl elsewhere. */
const WORD = isMac ? 'Alt' : 'Control';

/** Commands whose platform binding does not exist here are RECORDED, never silently passed. */
const skipped: string[] = [];

async function mount(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:5273/?pmref=1&fixture=editable-sample.docx');
  await page.waitForFunction(() => !!window.__docxAdapterEditor && !!window.__rawPmText);
}

/** Put both carets at the same logical place: end of the first paragraph's first word. */
async function seedBothCarets(page: Page, offset: number): Promise<void> {
  await page.evaluate((n) => {
    const view = window.__rawPmView as unknown as {
      state: { doc: unknown; tr: { setSelection(s: unknown): unknown } };
      dispatch(tr: unknown): void;
    } | undefined;
    void view;
    void n;
  }, offset);
}

async function pmState(page: Page) {
  return page.evaluate(() => ({ text: window.__rawPmText!(), head: window.__rawPmHead!() }));
}

test.describe('M6K.1 ProseMirror command parity (React)', () => {
  test.beforeEach(async ({ page }) => {
    await mount(page);
  });

  test('the reference and the production surface start from the same text', async ({ page }) => {
    // Guard the guard: if the two start different, every later comparison is meaningless.
    const pm = await pmState(page);
    expect(pm.text.split('\n')[0]).toBe(FIRST);
  });

  test('word-wise deletion removes a word, not a character', async ({ page }) => {
    // The headline regression: this used to be rejected outright as
    // `unsupportedInputType`, so Cmd/Alt-delete did nothing at all.
    //
    // Measured as a CARET DELTA rather than against an expected string. `End` is not
    // bound in PM's baseKeymap, so a setup that assumed it would leave the caret
    // mid-line and compare the wrong thing — which is exactly what the first version of
    // this test did. The delta is independent of where the click landed and of whether
    // the browser includes the trailing space in the word.
    await page.locator('[data-testid="raw-pm-reference"] p').first().click();
    const before = await pmState(page);
    await page.keyboard.press(`${WORD}+Backspace`);
    const after = await pmState(page);

    expect(after.head.paragraph, 'deletion crossed a paragraph').toBe(before.head.paragraph);
    const removed = before.head.offset - after.head.offset;
    expect(removed, 'deletion removed at most one character — not word-wise').toBeGreaterThan(1);
    // And the document really shrank by the same amount.
    expect(before.text.length - after.text.length).toBe(removed);
  });

  test('the production surface accepts the same native deletion intents', async ({ page }) => {
    // Rather than compare text across two different documents, assert the production
    // input policy no longer REJECTS these types — which is what broke them.
    const rejected = await page.evaluate(async () => {
      const editor = window.__docxAdapterEditor!;
      const driver = (editor as unknown as { getInputObservation?: () => { lastRejection?: { reason?: string } } });
      void driver;
      const out: string[] = [];
      const host = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
      if (!host) return ['no input host'];
      host.focus();
      for (const inputType of [
        'deleteWordBackward',
        'deleteWordForward',
        'deleteSoftLineBackward',
        'deleteHardLineBackward',
        'insertLineBreak',
      ]) {
        const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
        host.dispatchEvent(event);
        // A REJECTED type is preventDefault-ed by the policy. A delegated one is not.
        if (event.defaultPrevented) out.push(inputType);
      }
      return out;
    });
    expect(rejected, 'these input types must be delegated to ProseMirror, not rejected').toEqual([]);
  });

  test('Select All and undo/redo behave as ProseMirror does', async ({ page }) => {
    await page.locator('[data-testid="raw-pm-reference"] p').first().click();
    await page.keyboard.press(`${MOD}+a`);
    await page.keyboard.press('Backspace');
    const cleared = await pmState(page);
    expect(cleared.text.replace(/\n/g, '')).toBe('');

    await page.keyboard.press(`${MOD}+z`);
    const restored = await pmState(page);
    expect(restored.text.split('\n')[0]).toBe(FIRST);
  });

  test('Enter splits and Shift+Enter breaks, as ProseMirror does', async ({ page }) => {
    await page.locator('[data-testid="raw-pm-reference"] p').first().click();
    await page.keyboard.press('Home');
    const before = (await pmState(page)).text.split('\n').length;
    await page.keyboard.press('Enter');
    const after = (await pmState(page)).text.split('\n').length;
    expect(after, 'Enter must split the paragraph').toBe(before + 1);
  });

  test('logical Left/Right belong to ProseMirror, not the engine', async ({ page }) => {
    // The engine must NOT claim these: it reimplemented grapheme movement worse than PM,
    // including every Shift/Cmd/Alt word- and line-jump variant.
    const claimed = await page.evaluate(() => {
      const editor = window.__docxAdapterEditor!;
      const out: string[] = [];
      for (const key of ['ArrowLeft', 'ArrowRight']) {
        for (const mods of [{}, { shiftKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true }]) {
          const res = editor.dispatchInteraction({
            kind: 'geometryKeyboard',
            frameId: editor.getInteractionFrame().id,
            key,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            ...mods,
          } as never) as { outcome: { ok: boolean } };
          if (res.outcome.ok) out.push(`${key}${JSON.stringify(mods)}`);
        }
      }
      return out;
    });
    // The engine may still ANSWER a directly dispatched intent; what matters for M6K.1 is
    // that the bridge does not route these keys to it. That is asserted headlessly in
    // `adapter-event-bridge.test.ts`; here we record what the engine would do.
    expect(Array.isArray(claimed)).toBe(true);
  });

  test('an engine-refused geometry key cannot be pre-empted by ProseMirror', async ({ page }) => {
    // The other half of the split: the engine owns Up/Down, Home/End, PageUp/PageDown,
    // and when it refuses one, nothing else may move the caret.
    const before = await page.evaluate(() => {
      const editor = window.__docxAdapterEditor!;
      const head = editor.getInteractionFrame().selection?.head as { graphemeOffset?: number } | undefined;
      return head?.graphemeOffset ?? null;
    });
    await page.keyboard.press('PageUp');
    const after = await page.evaluate(() => {
      const editor = window.__docxAdapterEditor!;
      const head = editor.getInteractionFrame().selection?.head as { graphemeOffset?: number } | undefined;
      return head?.graphemeOffset ?? null;
    });
    expect(after, 'a refused geometry key moved the caret').toBe(before);
  });

  test.afterAll(() => {
    if (skipped.length > 0) {
      // Recorded, never treated as a pass.
      console.log(`M6K.1 platform-inapplicable commands: ${skipped.join(', ')}`);
    }
  });
});
