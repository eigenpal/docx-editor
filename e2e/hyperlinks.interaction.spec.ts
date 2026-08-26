// Hyperlinks & in-document navigation — acceptance suite for
// `openspec/changes/typed-hyperlinks-and-bookmarks`.
//
// Drives section 9 ("Hyperlinks & Cross-References") of
// `e2e/fixtures/comprehensive-word-element-test.docx` on the React demo:
//   9.1 External links — `w:hyperlink r:id` → https://example.com and
//       https://www.anthropic.com (TargetMode="External").
//   9.2 Internal links — `w:hyperlink w:anchor` → the `section1`, `section6`,
//       and `section12` bookmarks, each a `w:bookmarkStart` on a Heading1
//       paragraph elsewhere in the 25-page document.
//
// Contract under test (see the change's specs):
// - Hyperlink run text is measured and painted like any other run (today the
//   engine drops it: 9.1 paints as "Visit  or ."), wrapped in an
//   `a.docx-hyperlink` whose `href` is the sanitized projection.
// - Clicking an external link opens the hyperlink popover
//   (`data-testid="hyperlink-popup"`) showing the URL — it never navigates the
//   host page or opens a tab without explicit activation.
// - Clicking an internal link shows no popover; it scrolls the bookmarked
//   heading into view and places the caret at the bookmark target.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page.ts';

const DEMO_URL = 'http://localhost:5273/?fixture=comprehensive-word-element-test.docx';
const SCROLLER = '.docx-editor__scroll-container';
const POPUP = '[data-testid="hyperlink-popup"]';

// Fixture display texts use a curly apostrophe (U+2019) and en dashes (U+2013).
const P91_TEXT = 'Visit Example.com or Anthropic’s website.';

test.beforeEach(async ({ page }) => {
  // `domcontentloaded`: the demo shell pulls a woff2 from fonts.gstatic.com, and a
  // hanging request means the load event never fires.
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });
});

/**
 * Pages are virtualized: paragraphs materialize only near the viewport. Scroll
 * the document until a paragraph fragment containing `needle` is painted, and
 * return its locator.
 */
async function scrollToParagraph(page: Page, needle: string): Promise<Locator> {
  const scroller = page.locator(SCROLLER).first();
  for (let i = 0; i < 60; i++) {
    const fragment = page
      .locator('.docx-paragraph-fragment')
      .filter({ hasText: needle })
      .first();
    if ((await fragment.count()) > 0) {
      await fragment.scrollIntoViewIfNeeded();
      // `scrollIntoViewIfNeeded` is a PROGRAMMATIC scroll, and a programmatic scroll can
      // leave the engine's page virtualization a step behind — the fragment is painted but
      // the pages either side of it may not be, and the next repaint replaces the very node
      // this locator resolved. Settle first, so a click lands on a node that will still be
      // there when it arrives.
      await settle(page);
      return fragment;
    }
    await scroller.evaluate((el) => (el.scrollTop += el.clientHeight * 0.9));
    await settle(page);
  }
  throw new Error(`No painted paragraph contains ${JSON.stringify(needle)}`);
}

/**
 * Let the surface finish rematerializing after a programmatic scroll.
 *
 * The engine decides which pages to build in detail from a real scroll signal, so a test
 * that moves `scrollTop` directly has to nudge it and then wait for the repaint to land.
 */
async function settle(page: Page): Promise<void> {
  await page
    .locator(SCROLLER)
    .first()
    .evaluate((el) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, bubbles: true })));
  await page.waitForTimeout(250);
}

/**
 * Click a painted link at its LIVE position.
 *
 * `locator.click()` measures the element, then dispatches — and in between, the surface can
 * repaint: materializing another page changes the sheet extent, which re-centres every page
 * horizontally, so the measured box is stale by a few pixels and the click lands on the page
 * background instead of the link. (Observed directly: the click's target came back as
 * `.docx-pages`.) Reading the rect immediately before dispatching closes that window.
 */
async function clickLink(page: Page, link: Locator): Promise<void> {
  await expect(link).toHaveCount(1);
  await settle(page);
  // Past the surface's multi-click window (500ms), so two clicks on the same link in one
  // test are two CLICKS and not a double-click. A double-click selects the word — a range —
  // and a range selection deliberately does not open the popover, so without this the second
  // click in the dismiss test was testing the wrong gesture.
  await page.waitForTimeout(600);
  const box = await link.boundingBox();
  if (!box) throw new Error('link has no box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** True when the paragraph fragment containing `needle` intersects the viewport. */
function headingInViewport(page: Page, needle: string) {
  return page.waitForFunction(
    (marker) => {
      const frags = document.querySelectorAll('.docx-paragraph-fragment');
      for (const frag of frags) {
        if (!frag.textContent?.includes(marker)) continue;
        const rect = frag.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) return true;
      }
      return false;
    },
    needle,
    { timeout: 20_000 }
  );
}

const scrollTop = (page: Page) =>
  page.locator(SCROLLER).first().evaluate((el) => el.scrollTop);

test.describe('section 9 rendering', () => {
  test('external hyperlink text is painted, styled, and carries the sanitized href', async ({
    page,
  }) => {
    const p91 = await scrollToParagraph(page, 'Visit ');

    // The run text inside `w:hyperlink` must survive layout — no dropped content.
    expect((await p91.textContent())?.trim()).toBe(P91_TEXT);

    const example = p91.locator('a.docx-hyperlink[href="https://example.com"]');
    await expect(example).toHaveText('Example.com');
    await expect(
      p91.locator('a.docx-hyperlink[href="https://www.anthropic.com"]')
    ).toHaveText('Anthropic’s website');

    // The Hyperlink character style resolves through the cascade: colored + underlined.
    //
    // Read from the TEXT-BEARING nodes, not from the anchor. Colour and decoration belong to
    // the runs — that is where the resolved character style lands, and it is why an authored
    // override still wins over the style. The anchor is furniture and deliberately imposes
    // neither, so asking it would be asking the wrong element.
    const style = await example.evaluate((a) => {
      const nodes = [...a.querySelectorAll<HTMLElement>('*')];
      return {
        colors: nodes.map((n) => getComputedStyle(n).color),
        underlined: nodes.some((n) => getComputedStyle(n).textDecorationLine.includes('underline')),
      };
    });
    expect(style.underlined).toBe(true);
    expect(style.colors.some((color) => color !== 'rgb(0, 0, 0)')).toBe(true);
  });

  test('internal cross-references paint as anchors targeting their bookmarks', async ({
    page,
  }) => {
    const p92 = await scrollToParagraph(page, 'Jump to:');

    expect((await p92.textContent())?.trim()).toBe(
      'Jump to: Section 1 | Section 6 – Nested Tables | Section 12 – Form Elements'
    );
    await expect(p92.locator('a.docx-hyperlink[href="#section1"]')).toHaveText('Section 1');
    await expect(p92.locator('a.docx-hyperlink[href="#section6"]')).toHaveText(
      'Section 6 – Nested Tables'
    );
    await expect(p92.locator('a.docx-hyperlink[href="#section12"]')).toHaveText(
      'Section 12 – Form Elements'
    );
  });
});

test.describe('external link activation', () => {
  test('click opens the hyperlink popover with the URL and never navigates', async ({ page }) => {
    const p91 = await scrollToParagraph(page, 'Visit ');
    await clickLink(page, p91.locator('a.docx-hyperlink[href="https://example.com"]'));

    const popup = page.locator(POPUP);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('https://example.com');

    // No host-page navigation, no zero-click tab.
    expect(page.url()).toContain('localhost:5273');
    expect(page.context().pages()).toHaveLength(1);
  });

  test('popover exposes copy, edit, and unlink actions', async ({ page }) => {
    const p91 = await scrollToParagraph(page, 'Visit ');
    await clickLink(page, p91.locator('a.docx-hyperlink[href="https://example.com"]'));

    const popup = page.locator(POPUP);
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId('hyperlink-popup-copy')).toBeVisible();
    await expect(popup.getByTestId('hyperlink-popup-edit')).toBeVisible();
    await expect(popup.getByTestId('hyperlink-popup-unlink')).toBeVisible();
  });

  test('popover dismisses on Escape and on clicking elsewhere', async ({ page }) => {
    const p91 = await scrollToParagraph(page, 'Visit ');
    const link = p91.locator('a.docx-hyperlink[href="https://example.com"]');

    await clickLink(page, link);
    await expect(page.locator(POPUP)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(POPUP)).not.toBeVisible();

    await clickLink(page, link);
    await expect(page.locator(POPUP)).toBeVisible();
    await page.locator(PAINTED_PAGE).first().click({ position: { x: 30, y: 30 } });
    await expect(page.locator(POPUP)).not.toBeVisible();
  });
});

test.describe('in-document navigation', () => {
  test('internal link jumps backward to its bookmarked heading without a popover', async ({
    page,
  }) => {
    const p92 = await scrollToParagraph(page, 'Jump to:');
    const before = await scrollTop(page);

    await clickLink(page, p92.locator('a.docx-hyperlink[href="#section1"]'));

    await headingInViewport(page, '1. Text Formatting & Typography');
    expect(await scrollTop(page)).toBeLessThan(before);
    await expect(page.locator(POPUP)).toHaveCount(0);
  });

  test('internal link jumps forward across pages to a not-yet-painted target', async ({
    page,
  }) => {
    // Section 12 lies several virtualized pages past section 9, so the jump must
    // work even when the target paragraph has no DOM yet.
    const p92 = await scrollToParagraph(page, 'Jump to:');
    const before = await scrollTop(page);

    await clickLink(page, p92.locator('a.docx-hyperlink[href="#section12"]'));

    await headingInViewport(page, '12. Form Elements & Checkboxes');
    expect(await scrollTop(page)).toBeGreaterThan(before);
    await expect(page.locator(POPUP)).toHaveCount(0);
  });

  test('mid-document bookmark jump lands on the section 6 heading', async ({ page }) => {
    const p92 = await scrollToParagraph(page, 'Jump to:');

    await clickLink(page, p92.locator('a.docx-hyperlink[href="#section6"]'));

    await headingInViewport(page, '6. Nested Tables');
    await expect(page.locator(POPUP)).toHaveCount(0);
  });
});
