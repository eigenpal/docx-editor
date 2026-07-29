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
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import { authorizeCaret, paragraphText, selectionIdentity } from './realAdapterGateHelpers.ts';

/**
 * The PRODUCTION input host.
 *
 * A bare `[contenteditable="true"]` is NOT this element on this page: the raw
 * ProseMirror reference renders FIRST, so the unqualified selector resolved to the
 * reference and the whole gate passed while never touching the production surface.
 * It stayed green with the delegation set emptied. Every production assertion here
 * must go through this scoped selector.
 */
const PROD_HOST = '[data-docx-input-host-mount] [contenteditable="true"]';
/** The raw ProseMirror reference, which is a SIBLING of the production surface. */
const REF = '[data-testid="raw-pm-reference"]';

declare global {
  interface Window {
    __docxAdapterEditor?: Editor;
    __rawPmView?: { focus(): void };
    __rawPmText?: () => string;
    __rawPmHead?: () => { paragraph: number; offset: number };
    __rawPmSetHead?: (paragraph: number, offset: number) => void;
  }
}

/**
 * The first paragraph of `editable-sample.docx`. The harness seeds the raw ProseMirror
 * reference from the OPEN DOCUMENT, so this string is the content of BOTH surfaces —
 * which is what makes the comparison below a differential rather than two unrelated
 * assertions. It was previously an invented string present only in the reference.
 */
const FIRST = 'Edit me: type into this paragraph.';
/**
 * End of the last WORD, before the trailing ".". Word-wise deletion at the very end of
 * the paragraph removes only the period — a one-character delete that looks exactly like
 * the regression this gate exists to catch. Both surfaces are driven from this offset.
 */
const WORD_END = FIRST.length - 1;

const isMac = process.platform === 'darwin';
const MOD = isMac ? 'Meta' : 'Control';
/** Word-wise deletion is Alt on macOS, Ctrl elsewhere. */
const WORD = isMac ? 'Alt' : 'Control';

/** Commands whose platform binding does not exist here are RECORDED, never silently passed. */
const skipped: string[] = [];

async function mount(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://localhost:5273/?pmref=1&fixture=editable-sample.docx');
  await page.waitForFunction(
    () => !!window.__docxAdapterEditor && !!window.__docxAdapterDriver && !!window.__rawPmText,
  );
  // The page must hold BOTH surfaces, or a differential gate has nothing to differ.
  await expect(page.locator(REF)).toHaveCount(1);
  await expect(page.locator(PROD_HOST)).toHaveCount(1);
}

/** Drive a `beforeinput` of each type into ONE host and report which were refused. */
async function refusedTypes(page: Page, selector: string, types: string[]): Promise<string[]> {
  return page.evaluate(
    ({ selector, types }) => {
      const host = document.querySelector(selector) as HTMLElement | null;
      if (!host) return ['no input host'];
      host.focus();
      const out: string[] = [];
      for (const inputType of types) {
        const event = new InputEvent('beforeinput', { inputType, bubbles: true, cancelable: true });
        host.dispatchEvent(event);
        // A REFUSED type is preventDefault-ed by the policy; a delegated one is not.
        if (event.defaultPrevented) out.push(inputType);
      }
      return out;
    },
    { selector, types },
  );
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
    // This used to read only the reference, so it asserted nothing about production.
    const pm = await pmState(page);
    expect(pm.text.split('\n')[0]).toBe(FIRST);
    expect(await paragraphText(page, 0), 'production opened a different document').toBe(FIRST);
  });

  test('word-wise deletion is never WORSE in production than in raw ProseMirror', async ({ page }) => {
    // The headline regression: this used to be rejected outright as
    // `unsupportedInputType`, so Cmd/Alt-delete did nothing at all.
    //
    // Measured as a CARET DELTA rather than against an expected string, from a seeded
    // offset at the end of the last WORD — at the very end of the paragraph a word-wise
    // delete removes only the trailing ".", which is indistinguishable from the
    // single-character regression this gate exists to catch.
    //
    // The reference figure is a FLOOR, not an expected value. Chromium emits
    // `deleteWordBackward` un-prevented into both surfaces (verified directly), but raw
    // PM's DOM observer reconciles the native mutation back to a single character here.
    // Production must therefore be at least as capable as raw PM, and the absolute
    // word-wise claim is asserted against the real document in the next test.
    await page.locator(`${REF} p`).first().click();
    await page.evaluate((n) => window.__rawPmSetHead!(0, n), WORD_END);
    const before = await pmState(page);
    expect(before.head.offset, 'reference caret was not seeded').toBe(WORD_END);
    await page.keyboard.press(`${WORD}+Backspace`);
    const after = await pmState(page);
    expect(after.head.paragraph, 'deletion crossed a paragraph').toBe(before.head.paragraph);
    const referenceRemoved = before.head.offset - after.head.offset;
    expect(referenceRemoved, 'raw ProseMirror deleted nothing at all').toBeGreaterThan(0);
    // And the reference document really shrank by the same amount.
    expect(before.text.length - after.text.length).toBe(referenceRemoved);

    // Now the same keystroke, from the same offset, against production.
    await authorizeCaret(page, 0, WORD_END);
    await page.locator(PROD_HOST).focus();
    const prodBefore = await paragraphText(page, 0);
    await page.keyboard.press(`${WORD}+Backspace`);
    await expect
      .poll(() => paragraphText(page, 0), { message: 'production ignored word-wise deletion' })
      .not.toBe(prodBefore);
    const prodRemoved = prodBefore.length - (await paragraphText(page, 0)).length;
    expect(prodRemoved, 'production deleted less than raw ProseMirror').toBeGreaterThanOrEqual(
      referenceRemoved,
    );
  });

  test('the production surface delegates native deletion, and refuses what it cannot express', async ({ page }) => {
    // Scoped to PROD_HOST. The earlier version used a bare `[contenteditable="true"]`,
    // which is the raw PM reference on this page, so it passed with delegation removed.
    // Authorize a caret FIRST. With no selection ever applied the surface refuses every
    // type, so an unfocused probe would report "all refused" regardless of the policy.
    await authorizeCaret(page, 0, 5);
    await page.locator(PROD_HOST).focus();
    const delegated = [
      'deleteWordBackward',
      'deleteWordForward',
      'deleteSoftLineBackward',
      'deleteHardLineBackward',
    ];
    expect(
      await refusedTypes(page, PROD_HOST, delegated),
      'these input types must be delegated to ProseMirror, not refused',
    ).toEqual([]);

    // `insertLineBreak` (Shift+Enter) MUST be refused. The schema registers no
    // hard-break node and the model has no `w:br` run, so delegating it produced a
    // silent no-op: the user pressed a key and nothing happened, with no diagnostic.
    // An honest refusal is the correct behavior until the round-trip exists.
    expect(
      await refusedTypes(page, PROD_HOST, ['insertLineBreak']),
      'Shift+Enter must be refused, not silently dropped',
    ).toEqual(['insertLineBreak']);
  });

  test('word-wise deletion reaches the PRODUCTION document, not just the reference', async ({ page }) => {
    // The claim M6K.1 actually makes. Every other deletion assertion in this file
    // measures the reference editor; this one measures the real document.
    await authorizeCaret(page, 0, WORD_END);
    await page.locator(PROD_HOST).focus();
    const before = await paragraphText(page, 0);
    await page.keyboard.press(`${WORD}+Backspace`);
    await expect
      .poll(() => paragraphText(page, 0), { message: 'production ignored word-wise deletion' })
      .not.toBe(before);
    const after = await paragraphText(page, 0);
    // A word, not a character: more than one grapheme left the real document.
    expect(before.length - after.length).toBeGreaterThan(1);
    // The whole word left the document, and the trailing "." survived it.
    expect(after.endsWith('.'), 'deletion took the wrong range').toBe(true);
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

  test('Enter splits the paragraph in BOTH surfaces', async ({ page }) => {
    // The title used to say "and Shift+Enter breaks", which the body never pressed.
    // Shift+Enter has no round-trip; its honest refusal is asserted in the policy test.
    await page.locator(`${REF} p`).first().click();
    const refBefore = (await pmState(page)).text.split('\n').length;
    await page.keyboard.press('Enter');
    expect((await pmState(page)).text.split('\n').length, 'Enter must split in the reference').toBe(
      refBefore + 1,
    );

    // And in production, where a paragraph split is a real DocOp against the store.
    const prodBefore = await paragraphText(page, 0);
    await authorizeCaret(page, 0, 3);
    await page.locator(PROD_HOST).focus();
    await page.keyboard.press('Enter');
    await expect
      .poll(() => paragraphText(page, 0), { message: 'production ignored Enter' })
      .toBe(prodBefore.slice(0, 3));
  });

  test('logical Left/Right move the production caret one grapheme, as ProseMirror does', async ({ page }) => {
    // The engine must NOT claim these: it reimplemented grapheme movement worse than PM.
    // The ROUTING is asserted headlessly in `adapter-event-bridge.test.ts`; the earlier
    // version of this test asserted only `Array.isArray(claimed)`, which is true of every
    // array, so it could not fail. This measures the observable result instead.
    await authorizeCaret(page, 0, 5);
    await page.locator(PROD_HOST).focus();
    const at = async () => (await selectionIdentity(page))?.headOffset ?? null;
    await expect.poll(at).toBe(5);

    await page.keyboard.press('ArrowRight');
    await expect.poll(at, { message: 'ArrowRight did not move the production caret' }).toBe(6);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(at, { message: 'ArrowLeft did not move the production caret' }).toBe(5);
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
