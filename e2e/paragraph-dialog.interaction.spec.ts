// The Paragraph dialog — the parts only a real browser can hold.
//
// The unit suite covers what the dialog WRITES. These are the two behaviours happy-dom
// cannot reproduce, both of which shipped broken and were caught by hand:
//
//   1. Pressing OK threw the caret to the top of the document. The surface re-syncs the
//      DOM selection after a commit, but only while it holds focus, so handing focus back
//      afterwards landed on a repainted tree with no selection in it and the browser put
//      the caret at offset zero. Cancel never showed it, because nothing repaints.
//   2. The panel scrolled as one box, so OK and Cancel sat below the fold on an ordinary
//      laptop viewport — the form ended mid-control with no button and no scrollbar cue.
//
// Both depend on real focus, real selection and real layout. A jsdom-family environment
// reports success either way, which is worse than no test.

import { expect, test, type Page } from '@playwright/test';

const DEMO_URL = 'http://localhost:5273/';
const SCROLLER = '.docx-editor__scroll-container';
const DIALOG = '[role="dialog"][aria-label="Paragraph"]';

test.beforeEach(async ({ page }) => {
  // `domcontentloaded`: the demo shell pulls a woff2 from fonts.gstatic.com, and a hanging
  // request means the load event never fires.
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.docx-page', { timeout: 30_000 });
});

/** Open the dialog the way a user does: the line-spacing menu, then its options row. */
async function openParagraphDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Line spacing', exact: true }).click();
  await page.getByRole('menuitem', { name: /Line spacing options/ }).click();
  await page.waitForSelector(DIALOG);
}

/**
 * Click into a paragraph that is ACTUALLY on screen and put the caret there.
 *
 * Pages are virtualized and paragraphs materialize near the viewport, so the first match
 * in document order is usually not painted where the user is looking. Returns false when
 * nothing suitable is on screen.
 */
async function clickIntoVisibleParagraph(page: Page): Promise<boolean> {
  const point = await page.evaluate(() => {
    const candidates = [...document.querySelectorAll('[data-paragraph-id]')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return (
        rect.top > 120 &&
        rect.bottom < window.innerHeight - 80 &&
        rect.width > 100 &&
        (node.textContent ?? '').trim().length > 20
      );
    });
    const target = candidates[Math.min(2, candidates.length - 1)];
    if (!target) return null;
    const rect = target.getBoundingClientRect();
    return { x: rect.x + 40, y: rect.y + rect.height / 2 };
  });
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  return true;
}

/** Where the caret is, in the engine's terms rather than the DOM's. */
async function caretAt(page: Page): Promise<{ paragraphId: string | null; scrollTop: number }> {
  return page.evaluate((scrollerSelector) => {
    const selection = window.getSelection();
    const node = selection?.anchorNode ?? null;
    const element = node?.nodeType === 3 ? node.parentElement : (node as Element | null);
    const paragraph = element?.closest('[data-paragraph-id]') ?? null;
    const scroller = document.querySelector(scrollerSelector);
    return {
      paragraphId: paragraph?.getAttribute('data-paragraph-id') ?? null,
      scrollTop: scroller instanceof HTMLElement ? scroller.scrollTop : 0,
    };
  }, SCROLLER);
}

test('OK keeps the caret where the user left it, deep in the document', async ({ page }) => {
  const scroller = page.locator(SCROLLER).first();
  await scroller.evaluate((element) => {
    element.scrollTop = 3000;
  });
  await page.waitForTimeout(300);

  // The caret needs somewhere real to be lost FROM.
  expect(
    await clickIntoVisibleParagraph(page),
    'no paragraph painted at this scroll position'
  ).toBe(true);

  const before = await caretAt(page);
  expect(before.paragraphId).not.toBeNull();
  expect(before.scrollTop).toBeGreaterThan(1000);

  await openParagraphDialog(page);
  await page.getByLabel('Before', { exact: true }).fill('24');
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await expect(page.locator(DIALOG)).toHaveCount(0);

  const after = await caretAt(page);
  // The same paragraph, and the same place in the document. Before the fix both collapsed
  // to the first paragraph at the very top.
  expect(after.paragraphId).toBe(before.paragraphId);
  expect(after.scrollTop).toBe(before.scrollTop);
});

test('Cancel keeps the caret too, and writes nothing', async ({ page }) => {
  // The control case: Cancel never repaints, so it was fine even when OK was broken.
  // Asserting it keeps the two paths honest about being the same promise.
  expect(await clickIntoVisibleParagraph(page)).toBe(true);
  const before = await caretAt(page);

  await openParagraphDialog(page);
  await page.getByLabel('Before', { exact: true }).fill('24');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.locator(DIALOG)).toHaveCount(0);

  expect(await caretAt(page)).toEqual(before);
  await expect(page.getByRole('button', { name: /^Undo/ })).toBeDisabled();
});

test('the buttons are on screen when the dialog opens, on a laptop viewport', async ({ page }) => {
  // 778px is an ordinary 13" browser viewport. The whole panel used to scroll, which put
  // OK and Cancel below the fold with nothing to say more existed.
  await page.setViewportSize({ width: 1440, height: 778 });
  expect(await clickIntoVisibleParagraph(page)).toBe(true);
  await openParagraphDialog(page);

  for (const name of ['OK', 'Cancel']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeInViewport();
  }

  // And they STAY there while the form scrolls, rather than riding the content away.
  const okBefore = await page.getByRole('button', { name: 'OK', exact: true }).boundingBox();
  await page.locator(DIALOG).evaluate((panel) => {
    const body = [...panel.children].find(
      (child) => child.scrollHeight > child.clientHeight
    ) as HTMLElement | undefined;
    if (body) body.scrollTop = body.scrollHeight;
  });
  await page.waitForTimeout(200);
  const okAfter = await page.getByRole('button', { name: 'OK', exact: true }).boundingBox();
  expect(okAfter?.y).toBeCloseTo(okBefore?.y ?? -1, 0);
  await expect(page.getByRole('button', { name: 'OK', exact: true })).toBeInViewport();
});

test('a tab stop reads as a measurement, not as a template placeholder', async ({ page }) => {
  // The two new catalogue keys shipped in the Mustache spelling, which `formatMessage`
  // leaves on screen: a 2.5" stop listed as `{2.5} in`. The unit suite now guards the
  // catalogue; this guards what actually reaches the glass.
  expect(await clickIntoVisibleParagraph(page)).toBe(true);
  await openParagraphDialog(page);

  await page.getByLabel('Position', { exact: true }).fill('2.5');
  await page.getByRole('button', { name: 'Set', exact: true }).click();

  const dialog = page.locator(DIALOG);
  await expect(dialog).toContainText('2.5 in');
  await expect(dialog).not.toContainText('{');
  await expect(dialog).not.toContainText('}');
  await expect(page.getByRole('button', { name: /Clear the tab stop at 2\.5 inches/ })).toBeVisible();
});
