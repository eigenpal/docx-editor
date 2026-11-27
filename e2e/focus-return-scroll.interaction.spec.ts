import { devices, expect, test, type Page } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page';

// Issue #2116: WebKit restores the selection that the pages layer held when focus left, and
// reveals it, even with `focus({ preventScroll: true })`. A press in a scrolled document threw
// the reader back to the previous caret. Chromium does not reveal that selection, so this
// spec runs in WebKit.
test.use({ ...devices['Desktop Safari'], viewport: { width: 1440, height: 778 } });

const SCROLLER = '.docx-editor__scroll-container';

/** The centers of the body lines that are fully visible, top to bottom. */
async function visibleLines(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.docx-line[data-paragraph-id^="/word/document.xml#"]')]
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(
        ({ node, rect }) =>
          rect.top > 180 &&
          rect.bottom < innerHeight - 80 &&
          rect.width > 100 &&
          (node.textContent ?? '').length > 20
      )
      .map(({ node, rect }) => ({
        x: rect.x + 60,
        y: rect.y + rect.height / 2,
        paragraph: node.getAttribute('data-paragraph-id'),
      }))
  );
}

const scrollTop = (page: Page) =>
  page.locator(SCROLLER).first().evaluate((element) => element.scrollTop);

/** Put a caret on page 1, scroll away from it, and move focus to a control outside the editor. */
async function leaveCaretBehind(page: Page, port: number) {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
  await page.waitForSelector(PAINTED_PAGE);
  const [first] = await visibleLines(page);
  expect(first).toBeDefined();
  await page.mouse.click(first!.x, first!.y);
  await expect(page.locator('.docx-pages').first()).toBeFocused();

  await page.locator(SCROLLER).first().evaluate((element) => {
    element.scrollTop = 3000;
    // Record each position, so a jump away and back is also a failure.
    const seen: number[] = [];
    (window as unknown as { scrollPositions: number[] }).scrollPositions = seen;
    element.addEventListener('scroll', () => seen.push(element.scrollTop));
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const outside = document.createElement('button');
    outside.id = 'outside-focus';
    outside.textContent = 'Outside';
    outside.style.cssText = 'position:fixed;top:4px;left:4px;z-index:99999';
    // Safari does not focus a button on click. A menu that focuses its first item does.
    outside.addEventListener('click', () => outside.focus());
    document.body.append(outside);
    (window as unknown as { scrollPositions: number[] }).scrollPositions.length = 0;
  });
  await page.click('#outside-focus');
  await expect(page.locator('#outside-focus')).toBeFocused();
  expect(await scrollTop(page)).toBe(3000);
}

const scrollPositions = (page: Page) =>
  page.evaluate(() => (window as unknown as { scrollPositions: number[] }).scrollPositions);

for (const [framework, port] of [
  ['React', 5273],
  ['Vue', 5274],
] as const) {
  test(`${framework}: a press after focus left keeps the scroll position`, async ({ page }) => {
    await leaveCaretBehind(page, port);
    const [target] = await visibleLines(page);
    expect(target).toBeDefined();
    await page.mouse.click(target!.x, target!.y);
    await expect(page.locator('.docx-pages').first()).toBeFocused();
    await page.waitForTimeout(300);
    expect(await scrollPositions(page)).toEqual([]);
    expect(await scrollTop(page)).toBe(3000);

    await page.keyboard.type('FOCUSRETURN');
    await expect(
      page.locator('.docx-paragraph-fragment').filter({ hasText: 'FOCUSRETURN' })
    ).toHaveAttribute('data-paragraph-id', target!.paragraph!);
    expect(await scrollPositions(page)).toEqual([]);
  });

  test(`${framework}: a Shift press after focus left extends the selection in place`, async ({
    page,
  }) => {
    await leaveCaretBehind(page, port);
    const lines = await visibleLines(page);
    expect(lines.length).toBeGreaterThan(1);
    const from = lines[0]!;
    const to = lines[lines.length - 1]!;
    await page.mouse.click(from.x, from.y);
    await page.click('#outside-focus');
    await expect(page.locator('#outside-focus')).toBeFocused();

    await page.keyboard.down('Shift');
    await page.mouse.click(to.x + 80, to.y);
    await page.keyboard.up('Shift');
    await expect(page.locator('.docx-pages').first()).toBeFocused();
    await page.waitForTimeout(300);
    expect(await scrollPositions(page)).toEqual([]);
    const selection = await page.evaluate(() => {
      const native = document.getSelection()!;
      return { collapsed: native.isCollapsed, length: native.toString().length };
    });
    expect(selection.collapsed).toBe(false);
    expect(selection.length).toBeGreaterThan(0);
  });
}
