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

const DEMO_URL = 'http://localhost:5273/?fixture=comprehensive-word-element-test.docx';
const SCROLLER = '.docx-editor__scroll-container';
const POPUP = '[data-testid="hyperlink-popup"]';

// Fixture display texts use a curly apostrophe (U+2019) and en dashes (U+2013).
const P91_TEXT = 'Visit Example.com or Anthropic’s website.';

test.beforeEach(async ({ page }) => {
  // `domcontentloaded`: the demo shell pulls a woff2 from fonts.gstatic.com, and a
  // hanging request means the load event never fires.
  await page.goto(DEMO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.docx-page', { timeout: 30_000 });
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
      return fragment;
    }
    await scroller.evaluate((el) => (el.scrollTop += el.clientHeight * 0.9));
    await page.waitForTimeout(150);
  }
  throw new Error(`No painted paragraph contains ${JSON.stringify(needle)}`);
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
    const style = await example.evaluate((a) => {
      const nodes = [a, ...a.querySelectorAll<HTMLElement>('*')];
      return {
        color: getComputedStyle(a).color,
        underlined: nodes.some((n) => getComputedStyle(n).textDecorationLine.includes('underline')),
      };
    });
    expect(style.underlined).toBe(true);
    expect(style.color).not.toBe('rgb(0, 0, 0)');
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
    await p91.locator('a.docx-hyperlink[href="https://example.com"]').click();

    const popup = page.locator(POPUP);
    await expect(popup).toBeVisible();
    await expect(popup).toContainText('https://example.com');

    // No host-page navigation, no zero-click tab.
    expect(page.url()).toContain('localhost:5273');
    expect(page.context().pages()).toHaveLength(1);
  });

  test('popover exposes copy, edit, and unlink actions', async ({ page }) => {
    const p91 = await scrollToParagraph(page, 'Visit ');
    await p91.locator('a.docx-hyperlink[href="https://example.com"]').click();

    const popup = page.locator(POPUP);
    await expect(popup).toBeVisible();
    await expect(popup.getByTestId('hyperlink-popup-copy')).toBeVisible();
    await expect(popup.getByTestId('hyperlink-popup-edit')).toBeVisible();
    await expect(popup.getByTestId('hyperlink-popup-unlink')).toBeVisible();
  });

  test('popover dismisses on Escape and on clicking elsewhere', async ({ page }) => {
    const p91 = await scrollToParagraph(page, 'Visit ');
    const link = p91.locator('a.docx-hyperlink[href="https://example.com"]');

    await link.click();
    await expect(page.locator(POPUP)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(POPUP)).not.toBeVisible();

    await link.click();
    await expect(page.locator(POPUP)).toBeVisible();
    await page.locator('.docx-page').first().click({ position: { x: 30, y: 30 } });
    await expect(page.locator(POPUP)).not.toBeVisible();
  });
});

test.describe('in-document navigation', () => {
  test('internal link jumps backward to its bookmarked heading without a popover', async ({
    page,
  }) => {
    const p92 = await scrollToParagraph(page, 'Jump to:');
    const before = await scrollTop(page);

    await p92.locator('a.docx-hyperlink[href="#section1"]').click();

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

    await p92.locator('a.docx-hyperlink[href="#section12"]').click();

    await headingInViewport(page, '12. Form Elements & Checkboxes');
    expect(await scrollTop(page)).toBeGreaterThan(before);
    await expect(page.locator(POPUP)).toHaveCount(0);
  });

  test('mid-document bookmark jump lands on the section 6 heading', async ({ page }) => {
    const p92 = await scrollToParagraph(page, 'Jump to:');

    await p92.locator('a.docx-hyperlink[href="#section6"]').click();

    await headingInViewport(page, '6. Nested Tables');
    await expect(page.locator(POPUP)).toHaveCount(0);
  });
});
