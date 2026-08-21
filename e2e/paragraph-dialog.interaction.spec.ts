// The Paragraph dialog — the one thing only a real browser can hold.
//
// Deliberately a single test. The rest of the dialog is covered by the unit suites, which
// are cheap and run on every push; this spec is not wired into CI and exists to be run by
// hand when the dialog's focus handling changes.
//
// What it guards: closing the dialog must leave the caret where the user left it. Typing in
// any field moves the DOM selection into that input, so by the time the dialog closes the
// document has none — and focusing a surface with no selection puts the caret at offset
// zero of the first paragraph, losing the user's place in a long document. Both close paths
// have shipped this bug: OK first, then Cancel, which looked fine only because nobody had
// typed before cancelling.
//
// It cannot live with the unit tests. happy-dom does not reproduce what a browser does to a
// selection on focus, so the same assertions there pass whether or not the code is right —
// worse than no test. Two attempts at that are why this file exists.
//
//   bunx playwright test --config e2e/editor-smoke.config.ts paragraph-dialog.interaction

import { expect, test, type Page } from '@playwright/test';

const DEMO_URL = 'http://localhost:5273/';
const DIALOG = '[role="dialog"][aria-label="Paragraph"]';

/** Which paragraph the caret sits in, by the engine's id rather than the DOM's shape. */
async function caretParagraph(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const node = window.getSelection()?.anchorNode ?? null;
    const element = node?.nodeType === 3 ? node.parentElement : (node as Element | null);
    return element?.closest('[data-paragraph-id]')?.getAttribute('data-paragraph-id') ?? null;
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

test('the caret survives the dialog, through both OK and Cancel', async ({ page }) => {
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

  const before = await caretParagraph(page);
  expect(before).not.toBeNull();
  const scrollBefore = await scroller.evaluate((element) => element.scrollTop);

  // ── OK, having typed, which is what moves the selection into a field ──────────────
  await openParagraphDialog(page);
  await expect(page.getByRole('button', { name: 'OK', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeInViewport();
  await page.getByLabel('Before', { exact: true }).fill('24');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator(DIALOG)).toHaveCount(0);

  expect(await caretParagraph(page), 'OK moved the caret').toBe(before);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(scrollBefore);

  // ── Cancel, also having typed ─────────────────────────────────────────────────────
  await openParagraphDialog(page);
  await page.getByLabel('Before', { exact: true }).fill('36');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator(DIALOG)).toHaveCount(0);

  expect(await caretParagraph(page), 'Cancel moved the caret').toBe(before);
  expect(await scroller.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
});
