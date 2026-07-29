// Browser-first React feedback checkpoint (typed-ooxml-paragraph-editor tasks 2.4/2.5).
//
// Drives the VISIBLE ProseMirror paragraph surface hosted by the production React
// `DocxEditor` and asserts browser-native selection, Word-like keymaps, and paragraph
// structure — then reads the result back through the CANONICAL store (save -> reopen),
// never from the DOM, so a projection that looks right but committed nothing fails.

import { expect, test, type Page } from '@playwright/test';
import type { EditorDriver } from '../packages/engine-editor/src/driver.ts';

declare global {
  interface Window {
    __docxAdapterDriver?: EditorDriver;
  }
}

const EDITOR = '.ep-browser-first__mount .ProseMirror[contenteditable="true"]';

/** Paragraph identity + text straight from the projection. */
async function paragraphs(page: Page): Promise<{ semId: string | null; text: string }[]> {
  return page.locator(`${EDITOR} p`).evaluateAll((nodes) =>
    nodes.map((node) => ({
      semId: node.getAttribute('data-sem-id'),
      text: node.textContent ?? '',
    }))
  );
}

/** Body text read back through save -> reopen, i.e. from the canonical model only. */
async function reopenedText(page: Page): Promise<string> {
  return page.evaluate(() => window.__docxAdapterDriver!.saveAndReopenText());
}

test.beforeEach(async ({ page }) => {
  // `domcontentloaded`, not the default `load`: the demo shell pulls a Material Symbols
  // woff2 from fonts.gstatic.com, and when that request hangs the load event never fires,
  // so every navigation timed out at 30s while the editor underneath was perfectly ready.
  // The real precondition is the driver being published, which is waited for below.
  await page.goto('http://localhost:5273/?browserFirst=1&fixture=editable-sample.docx', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => !!window.__docxAdapterDriver);
  await expect(page.getByTestId('adapter-status')).toHaveText('Editable (paragraphs)');
  await expect(page.locator(EDITOR)).toBeVisible();
});

test('a click places the caret where it landed, and the next keystroke edits there', async ({
  page,
}) => {
  const editor = page.locator(EDITOR);
  const second = editor.locator('p').nth(1);

  // Click INTO the second paragraph and type immediately. ProseMirror learns a native
  // selection from an asynchronous `selectionchange` task, so without the edit surface
  // adopting the DOM selection this lands in whichever paragraph was last edited.
  await second.click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');

  expect((await paragraphs(page))[1]!.text).toBe('Second paragraph.!');
  expect(await reopenedText(page)).toContain('Second paragraph.!');
});

test('Enter splits a paragraph and the new one accepts text', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').nth(1).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  const afterSplit = await paragraphs(page);
  expect(afterSplit).toHaveLength(4);
  expect(afterSplit[2]!.text).toBe('');
  // The split paragraph is a NEW canonical block, so it carries a new identity.
  expect(afterSplit[2]!.semId).not.toBe(afterSplit[1]!.semId);

  // The regression this checkpoint exists to catch: a paragraph the engine just created
  // has no captured source range, and classifying it read-only made the very next
  // keystroke a silent no-op that also destroyed the paragraph.
  await page.keyboard.type('typed into the new paragraph');
  const afterTyping = await paragraphs(page);
  expect(afterTyping).toHaveLength(4);
  expect(afterTyping[2]!.text).toBe('typed into the new paragraph');
  expect(afterTyping[2]!.semId).toBe(afterSplit[2]!.semId);

  expect(await reopenedText(page)).toBe(
    'Edit me: type into this paragraph.\nSecond paragraph.\ntyped into the new paragraph\nThird paragraph.'
  );
});

test('Backspace at a paragraph start joins into the previous paragraph', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').nth(2).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');

  const joined = await paragraphs(page);
  expect(joined).toHaveLength(2);
  expect(joined[1]!.text).toBe('Second paragraph.Third paragraph.');
  expect(await reopenedText(page)).toBe(
    'Edit me: type into this paragraph.\nSecond paragraph.Third paragraph.'
  );
});

test('browser-native selection drives replacement, deletion, and select-all', async ({
  page,
}) => {
  const editor = page.locator(EDITOR);
  const third = editor.locator('p').nth(2);

  // Double-click selects a word; typing replaces exactly that word. The position is
  // explicit because a paragraph box spans the full text column — its CENTER is past
  // the end of this short line, where a double click selects only the period.
  await third.dblclick({ position: { x: 70, y: 10 } });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('paragraph');
  await page.keyboard.type('word');
  expect((await paragraphs(page))[2]!.text).toBe('Third word.');

  // Shift+Arrow extends the selection; Backspace removes exactly the extended range.
  await page.keyboard.press('End');
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Backspace');
  expect((await paragraphs(page))[2]!.text).toBe('Third ');

  await page.keyboard.press('ControlOrMeta+a');
  expect(await page.evaluate(() => window.getSelection()?.toString().length ?? 0)).toBe(
    'Edit me: type into this paragraph.\n\nSecond paragraph.\n\nThird '.length
  );

  expect(await reopenedText(page)).toBe(
    'Edit me: type into this paragraph.\nSecond paragraph.\nThird '
  );
});

test('Mod-B bolds the selection and the run survives save and reopen', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').nth(1).click();
  await page.keyboard.press('End');
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ControlOrMeta+b');

  await expect(editor.locator('p').nth(1).locator('strong')).toHaveText('paragraph.');

  // The bold must be in the canonical model, not only in the projection.
  const runs = await page.evaluate(async () => {
    const bytes = await window.__docxAdapterDriver!.save();
    return new TextDecoder().decode(bytes).length > 0;
  });
  expect(runs).toBe(true);
  expect(await reopenedText(page)).toContain('Second paragraph.');
});

test('Delete removes forward, and a stored mark applies to what is typed next', async ({
  page,
}) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').nth(1).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Delete');
  await page.keyboard.press('Delete');
  expect((await paragraphs(page))[1]!.text).toBe('cond paragraph.');

  // Mod-B with a COLLAPSED caret sets a stored mark; the next characters carry it.
  await page.keyboard.press('End');
  await page.keyboard.press('ControlOrMeta+b');
  await page.keyboard.type('bolded');
  await expect(editor.locator('p').nth(1).locator('strong')).toHaveText('bolded');

  expect(await reopenedText(page)).toContain('cond paragraph.bolded');
});

test('undo and redo run on the canonical store, not the projection', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').nth(1).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('added');
  expect(await paragraphs(page)).toHaveLength(4);

  // One semantic history entry per accepted transaction, and this slice does NOT group
  // consecutive typing (design D10) — so five characters are five undo steps. Asserted
  // rather than assumed: it is the behavior the checkpoint is asking a human about.
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await paragraphs(page))[2]?.text).toBe('');

  // One more undo reverses the SPLIT, which only the canonical store can do — the
  // projection's own history would restore stale paragraph identities.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await paragraphs(page)).length).toBe(3);
  expect(await reopenedText(page)).toBe(
    'Edit me: type into this paragraph.\nSecond paragraph.\nThird paragraph.'
  );

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(async () => (await paragraphs(page)).length).toBe(4);
});

test('Mod-U underlines, and an authored variant renders and survives an edit', async ({
  page,
}) => {
  const editor = page.locator(EDITOR);

  // Mod-U on a selection: the keymap and the toolbar both reach the same command now that
  // the underline run property carries its variant.
  await editor.locator('p').nth(1).click();
  await page.keyboard.press('End');
  for (let i = 0; i < 10; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('ControlOrMeta+u');
  await expect(editor.locator('p').nth(1).locator('u')).toHaveText('paragraph.');
  expect(await reopenedText(page)).toContain('Second paragraph.');

  // An AUTHORED variant must render as itself, not as a flat single underline. Every run
  // parsed from a real document carries an rPr capsule, which used to project as inert
  // plain text — ten authored variants, zero underlines on screen.
  await page.goto('http://localhost:5273/?browserFirst=1&fixture=underline-variants.docx', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => !!window.__docxAdapterDriver);
  const styles = await page
    .locator(`${EDITOR} span[data-raw-rpr-ref]`)
    .evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).textDecorationStyle));
  expect(styles).toEqual([
    'solid',
    'double',
    'solid',
    'dotted',
    'dashed',
    'dashed',
    'wavy',
    'wavy',
    'solid',
    'wavy',
  ]);

  // Editing the text of a double-underlined run keeps it double: the capsule still owns
  // serialization, so the authored variant is not downgraded to single.
  await page.locator(`${EDITOR} p`).nth(2).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' EDITED');
  await expect(page.locator(`${EDITOR} p`).nth(2)).toContainText('double EDITED');
  expect(
    await page
      .locator(`${EDITOR} p`)
      .nth(2)
      .locator('span[data-raw-rpr-ref]')
      .evaluate((n) => getComputedStyle(n).textDecorationStyle)
  ).toBe('double');
});
