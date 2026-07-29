// The CANONICAL TREE stack driving a real browser (cutover step 2c).
//
// `?treeFirst=1` mounts `openTreeSession` + `mountTreeSurface`: bounded OPC read into
// typed/generic trees, `TreeDocumentStore`, the tree binding. It shares no code with the
// `PackageModel` path, so this is the gate that says the replacement actually works in a
// browser rather than only in unit tests.
//
// The fixture is deliberately the one the legacy path REFUSES: a paragraph with clipart in
// the middle of it. Under the byte-range model that document opens partial, the paragraph
// holding the drawing is read-only, and one drawing sets `structuralMutationAllowed` to
// false for the entire file.

import { expect, test, type Page } from '@playwright/test';

const EDITOR = '[data-testid="tree-mount"] .ProseMirror';

declare global {
  interface Window {
    __docxTreeSession?: {
      editable: boolean;
      paragraphIds(): string[];
      bodyText(): string;
      revision(): number;
      save(): Uint8Array;
    };
  }
}

const bodyText = (page: Page) => page.evaluate(() => window.__docxTreeSession!.bodyText());
const paragraphCount = (page: Page) =>
  page.evaluate(() => window.__docxTreeSession!.paragraphIds().length);

test.beforeEach(async ({ page }) => {
  // `domcontentloaded`: the demo shell pulls a woff2 from fonts.gstatic.com, and a hanging
  // request means the load event never fires.
  await page.goto('http://localhost:5273/?treeFirst=1&fixture=clipart-sample.docx', {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForFunction(() => !!window.__docxTreeSession);
  await expect(page.locator(EDITOR)).toBeVisible();
});

test('a document containing clipart opens EDITABLE on the tree', async ({ page }) => {
  await expect(page.getByTestId('tree-status')).toContainText('Editable');
  await expect(page.getByTestId('tree-status')).toContainText('3 paragraphs');
  expect(await bodyText(page)).toBe(
    'before  after the picture\ndouble underlined\nan ordinary paragraph you can split'
  );
});

test('typing beside the drawing commits to the canonical tree', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' EDITED');

  expect(await bodyText(page)).toContain('the picture EDITED');
  await expect(page.getByTestId('tree-revision')).not.toHaveText('rev 0');
  // Nothing was refused along the way.
  await expect(page.getByTestId('tree-rejection')).toHaveCount(0);
});

test('Enter at the end of a paragraph splits', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').nth(2).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');

  // Structural editing works in a document containing clipart, which the byte-range model
  // forbade outright.
  expect(await paragraphCount(page)).toBe(4);
  expect(await bodyText(page)).toBe(
    'before  after the picture\ndouble underlined\nan ordinary paragraph you can split\n'
  );
  // The caret is inside the paragraph Enter just created, ready for the next keystroke.
  expect(
    await page.evaluate(() => {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const paragraph =
        node?.nodeType === 3 ? node.parentElement?.closest('p') : (node as Element)?.closest?.('p');
      const all = [...document.querySelectorAll('[data-testid="tree-mount"] .ProseMirror p')];
      return paragraph ? all.indexOf(paragraph) : -1;
    })
  ).toBe(3);
});

test('typing at speed straight after Enter lands in the new paragraph', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').nth(2).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('a new paragraph');

  expect(await paragraphCount(page)).toBe(4);
  expect(await bodyText(page)).toBe(
    'before  after the picture\ndouble underlined\nan ordinary paragraph you can split\na new paragraph'
  );
});

test('Backspace at a paragraph start joins into the previous one', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').nth(2).click();
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');

  expect(await paragraphCount(page)).toBe(2);
  expect(await bodyText(page)).toContain('double underlinedan ordinary paragraph');
});

test('the drawing survives an edit, and the projection refuses to delete it', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');

  // The unknown atom is still in the paragraph that holds the drawing.
  await expect(
    editor.locator('p').first().locator('[data-token="unknown"]')
  ).toHaveCount(1);

  // Selecting the whole paragraph and deleting would remove the drawing; the binding
  // refuses it and the view snaps back rather than showing an edit the model never took.
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('tree-rejection')).toBeVisible();
  expect(await bodyText(page)).toContain('the picture!');
});

test('save and reopen round-trips through the tree', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' SAVED');

  await page.getByRole('button', { name: 'Save + reopen' }).click();
  // Read back from a session opened on the WRITTEN BYTES, not from the DOM.
  await expect(page.getByTestId('tree-saved-text')).toContainText('the picture SAVED');
  await expect(page.getByTestId('tree-saved-text')).toContainText('double underlined');
});

test('undo and redo run on the canonical store', async ({ page }) => {
  const editor = page.locator(EDITOR);
  await editor.locator('p').nth(2).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  expect(await paragraphCount(page)).toBe(4);

  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await paragraphCount(page)).toBe(3);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(await paragraphCount(page)).toBe(4);
});
