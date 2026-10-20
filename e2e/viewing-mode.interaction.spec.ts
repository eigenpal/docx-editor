// Viewing mode is for reading. A press on the pages places no caret, makes no selection
// and selects no object, so the toolbar keeps reporting what it reported before the press,
// and the text column shows the arrow rather than the I-beam. Links stay live.

import { expect, test, type Locator, type Page } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page.ts';

const URL = 'http://localhost:5273/?e2e=1&fixture=comprehensive-word-element-test.docx';
const HYPERLINK_TEXT = 'Visit Example.com or Anthropic';
const FOOTNOTE_TEXT = 'Standard footnote';
const INLINE_PICTURES_TEXT = 'Inline:';

async function open(page: Page): Promise<void> {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__DOCX_EDITOR_E2E__?.ready() === true);
  await page.waitForSelector(`${PAINTED_PAGE} .docx-paragraph-fragment`);
}

async function setMode(page: Page, mode: 'viewing' | 'editing'): Promise<void> {
  const result = await page.evaluate(
    (mode) => window.__DOCX_EDITOR_E2E__!.getEditor()!.exec({ type: 'setEditingMode', mode }).ok,
    mode
  );
  expect(result).toBe(true);
  await expect(page.locator('.docx-paginated-surface')).toHaveClass(
    mode === 'viewing' ? /docx-paginated-surface--viewing/ : /^(?!.*--viewing).*$/
  );
}

function selection(page: Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__!.getEditor()!.snapshot().selection);
}

function domSelectionText(page: Page) {
  return page.evaluate(() => document.getSelection()?.toString() ?? '');
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
}

/** Pages are virtualized, so wheel down until a fragment holding `needle` is painted. */
async function fragment(page: Page, needle: string): Promise<Locator> {
  const located = page.locator('.docx-paragraph-fragment').filter({ hasText: needle }).first();
  const scroller = page.locator('.docx-editor__scroll-container').first();
  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let attempt = 0; attempt < 80 && (await located.count()) === 0; attempt += 1) {
    await page.mouse.wheel(0, 600);
    await settle(page);
  }
  await located.scrollIntoViewIfNeeded();
  await settle(page);
  await expect(located).toBeVisible();
  return located;
}

async function cursorAt(page: Page, x: number, y: number): Promise<string> {
  return page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element ? getComputedStyle(element).cursor : 'none';
    },
    { x, y }
  );
}

test.describe('viewing mode', () => {
  test.beforeEach(async ({ page }) => {
    await open(page);
  });

  test('text shows the arrow and a press, drag or multi-click selects nothing', async ({
    page,
  }) => {
    const body = page.locator('.docx-paragraph-fragment').nth(2);
    const box = (await body.boundingBox())!;
    const x = box.x + 12;
    const y = box.y + box.height / 2;
    expect(await cursorAt(page, x, y)).toBe('text');

    await setMode(page, 'viewing');
    const before = await selection(page);
    expect(await cursorAt(page, x, y)).toBe('default');

    await page.mouse.click(x, y);
    await settle(page);
    expect(await selection(page)).toEqual(before);

    await page.mouse.dblclick(x, y);
    await settle(page);
    expect(await selection(page)).toEqual(before);
    expect(await domSelectionText(page)).toBe('');

    await page.mouse.click(x, y, { clickCount: 3 });
    await settle(page);
    expect(await selection(page)).toEqual(before);
    expect(await domSelectionText(page)).toBe('');

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y + 60, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    expect(await selection(page)).toEqual(before);
    expect(await domSelectionText(page)).toBe('');
    // No painted caret either.
    await expect(page.locator('[data-docx-caret]:visible')).toHaveCount(0);
  });

  // Caret keys are covered by `viewing-selection-lock.test.ts`: Chromium drops focus from
  // pages that stop being editable, so no real key reaches them here.

  test('a find match still paints its highlight', async ({ page }) => {
    await setMode(page, 'viewing');
    const body = page.locator(`${PAINTED_PAGE} .docx-paragraph-fragment:visible`).nth(2);
    await expect(body).toBeVisible();
    const word = (await body.textContent())!.trim().split(/\s+/)[0]!;
    expect(word.length).toBeGreaterThan(2);
    const selected = await page.evaluate((query) => {
      const editor = window.__DOCX_EDITOR_E2E__!.getEditor()!;
      const match = editor.findMatches(query)[0];
      return match ? editor.selectMatch(match).ok : false;
    }, word);
    expect(selected).toBe(true);
    await settle(page);
    expect(await domSelectionText(page)).toContain(word);
  });

  test('pictures and note references are not selected or entered', async ({ page }) => {
    await setMode(page, 'viewing');
    const before = await selection(page);

    const pictures = await fragment(page, INLINE_PICTURES_TEXT);
    const picture = pictures.locator('.docx-drawing').first();
    await expect(picture).toBeVisible();
    await picture.click();
    await settle(page);
    expect(await selection(page)).toEqual(before);
    expect(
      await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.getEditor()!.getSelectedImage())
    ).toBeNull();

    const notes = await fragment(page, FOOTNOTE_TEXT);
    const reference = notes.locator('[data-docx-note-ref]').first();
    await expect(reference).toBeVisible();
    await reference.click();
    await settle(page);
    expect(await selection(page)).toEqual(before);
  });

  // The popover itself is covered on the full demo in `hyperlinks.interaction.spec.ts`; this
  // harness mounts no popover part.
  test('links keep the pointer', async ({ page }) => {
    await setMode(page, 'viewing');
    const paragraph = await fragment(page, HYPERLINK_TEXT);
    const link = paragraph.locator('a.docx-hyperlink[href^="https://example.com"]').first();
    await expect(link).toBeVisible();
    const box = (await link.boundingBox())!;
    expect(await cursorAt(page, box.x + box.width / 2, box.y + box.height / 2)).toBe('pointer');
  });

  test('returning to editing restores the I-beam and caret placement', async ({ page }) => {
    await setMode(page, 'viewing');
    await setMode(page, 'editing');
    const body = page.locator('.docx-paragraph-fragment').nth(2);
    const box = (await body.boundingBox())!;
    const x = box.x + 12;
    const y = box.y + box.height / 2;
    expect(await cursorAt(page, x, y)).toBe('text');
    const before = await selection(page);
    await page.mouse.click(x, y);
    await settle(page);
    expect(await selection(page)).not.toEqual(before);
  });
});

// The reader-facing symptom, on both adapters' demos: the toolbar follows a click in editing
// and stays put in viewing.
for (const [adapter, url] of [
  ['React', 'http://localhost:5273/'],
  ['Vue', 'http://localhost:5274/'],
] as const) {
  test(`${adapter}: the toolbar does not follow a click or drag in viewing`, async ({ page }) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${PAINTED_PAGE} .docx-paragraph-fragment`);
    const size = page.locator('.docx-toolbar__font-size-input').first();
    const pill = page.getByTestId('editing-mode-trigger').first();
    const choose = async (mode: 'viewing' | 'editing') => {
      await pill.click();
      await page.getByTestId(`editing-mode-${mode}`).first().click();
      await expect(pill).toHaveAttribute('data-mode', mode);
    };
    // The title opens the demo; the body text below it is set in a smaller size.
    const body = page.locator(`${PAINTED_PAGE} .docx-paragraph-fragment:visible`).nth(2);
    await expect(body).toBeVisible();
    const box = (await body.boundingBox())!;
    const x = box.x + 12;
    const y = box.y + box.height / 2;

    await choose('viewing');
    const before = await size.inputValue();
    expect(await cursorAt(page, x, y)).toBe('default');
    await page.mouse.click(x, y);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 200, y + 60, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    await expect(size).toHaveValue(before);
    expect(await domSelectionText(page)).toBe('');

    // Control: the same click in editing does move the toolbar.
    await choose('editing');
    await page.mouse.click(x, y);
    await expect(size).not.toHaveValue(before);
  });
}
