// The Paragraph dialog — the one thing only a real browser can hold.
//
// Deliberately a single test. The rest of the dialog is covered by the unit suites, which
// are cheap and run on every push; this spec is not wired into CI and exists to be run by
// hand when the dialog's focus handling changes.
//
// What it guards, both of which this branch has shipped broken:
//
//   1. Closing must not MOVE the user. A restore that focuses the editing surface makes it
//      scroll its own caret into view a frame later, which after a repaginating write
//      throws the reader ~1800px away from the paragraph they just edited.
//   2. Closing must not leave a SELECTION behind. Restoring the engine's paragraph-granular
//      selection turns a caret into a whole-paragraph range, and the next keystroke then
//      replaces the paragraph. That is data loss, not a cosmetic slip.
//
// The dialog therefore leaves the document alone on close, and these are the two things
// that must stay true of it.
//
// It cannot live with the unit tests. happy-dom does not reproduce what a browser does to a
// selection on focus, so the same assertions there pass whether or not the code is right —
// worse than no test. Two attempts at that are why this file exists.
//
//   bunx playwright test --config e2e/editor-smoke.config.ts paragraph-dialog.interaction

import { expect, test, type Page } from '@playwright/test';

const DEMO_URL = 'http://localhost:5273/';
const DIALOG = '[role="dialog"][aria-label="Paragraph"]';

interface CaretState {
  readonly paragraph: string | null;
  readonly collapsed: boolean;
  readonly selectedText: string;
}

/**
 * Where the caret is AND how wide it is.
 *
 * The width is the point. A restore that puts the caret back in the right paragraph but
 * spanning the whole of it is worse than losing it: the next keystroke replaces the
 * paragraph instead of typing into it. An earlier version of this test asserted only the
 * paragraph id and passed while exactly that shipped.
 */
async function caretState(page: Page): Promise<CaretState> {
  return page.evaluate(() => {
    const selection = window.getSelection();
    const node = selection?.anchorNode ?? null;
    const element = node?.nodeType === 3 ? node.parentElement : (node as Element | null);
    return {
      paragraph: element?.closest('[data-paragraph-id]')?.getAttribute('data-paragraph-id') ?? null,
      collapsed: selection?.isCollapsed ?? true,
      selectedText: selection?.toString() ?? '',
    };
  });
}

/**
 * Click into a paragraph that is ACTUALLY painted on screen.
 *
 * Pages are virtualized, so the first match in document order is usually not where the user
 * is looking — and a click that lands nowhere leaves no caret to lose.
 */
async function clickIntoVisibleParagraph(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const painted = [...document.querySelectorAll('[data-paragraph-id]')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.top > 120 &&
        rect.bottom < window.innerHeight - 80 &&
        rect.width > 100 &&
        (node.textContent ?? '').trim().length > 20
      );
    });
    const target = painted[Math.min(2, painted.length - 1)];
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.x + 40, y: rect.y + rect.height / 2 };
  });
  expect(point, 'no paragraph painted on screen to click into').not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

async function openParagraphDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Line spacing', exact: true }).click();
  await page.getByRole('menuitem', { name: /Line spacing options/ }).click();
  await page.waitForSelector(DIALOG);
}

test('closing the dialog moves neither the document nor the text', async ({ page }) => {
  // An ordinary 13" viewport: the buttons have to be reachable without scrolling the form.
  await page.setViewportSize({ width: 1440, height: 778 });
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.docx-page', { timeout: 30_000 });

  // Deep enough into the document that a jump to the top is unmistakable.
  const scroller = page.locator('.docx-editor__scroll-container').first();
  await scroller.evaluate((element) => {
    element.scrollTop = 3000;
  });
  await page.waitForTimeout(300);
  await clickIntoVisibleParagraph(page);

  const before = await caretState(page);
  expect(before.paragraph).not.toBeNull();
  expect(before.collapsed).toBe(true);
  const paragraphText = await page.evaluate(
    (id) => document.querySelector(`[data-paragraph-id="${CSS.escape(id!)}"]`)?.textContent ?? null,
    before.paragraph
  );
  const scrollBefore = await scroller.evaluate((element) => element.scrollTop);

  // ── OK, having typed, which is what moves the selection into a field ──────────────
  await openParagraphDialog(page);
  await expect(page.getByRole('button', { name: 'OK', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await page.getByLabel('Before', { exact: true }).fill('24');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator(DIALOG)).toHaveCount(0);

  // The user is still looking at what they were looking at.
  expect(await scroller.evaluate((element) => element.scrollTop), 'OK scrolled the document').toBe(
    scrollBefore
  );
  // And nothing is selected, so the next keystroke types rather than replaces. Weaker than
  // it looks: with the dialog leaving the document alone there is usually no selection at
  // all by this point, so this assertion holds trivially. It is kept as a tripwire for a
  // future restore mechanism, not as proof the current one is safe.
  expect((await caretState(page)).collapsed, 'OK left a selection behind').toBe(true);
  // The paragraph the dialog formatted still holds its text.
  expect(
    await page.evaluate(
      (id) =>
        document.querySelector(`[data-paragraph-id="${CSS.escape(id!)}"]`)?.textContent ?? null,
      before.paragraph
    )
  ).toBe(paragraphText);

  // ── Cancel, also having typed ─────────────────────────────────────────────────────
  await openParagraphDialog(page);
  await page.getByLabel('Before', { exact: true }).fill('36');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator(DIALOG)).toHaveCount(0);

  expect(
    await scroller.evaluate((element) => element.scrollTop),
    'Cancel scrolled the document'
  ).toBe(scrollBefore);
  expect((await caretState(page)).collapsed, 'Cancel left a selection behind').toBe(true);
  // Not asserted: that the caret is still IN the paragraph. The dialog deliberately does
  // not put focus back on the document — see the note on the React dialog's focus effect —
  // so after either close path the user clicks once to resume typing. Writing that
  // assertion would pin behaviour the dialog does not promise.
});
