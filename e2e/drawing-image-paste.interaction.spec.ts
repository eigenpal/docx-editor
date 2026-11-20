// Pasting an image file while a picture, shape or text box is selected, in a real browser, in
// both demos. The selection overlay holds focus beside the pages, so the paste reaches the
// image-file lane through the overlay.

import { expect, test, type Page } from '@playwright/test';
import { PAINTED_PAGE } from './painted-page.ts';
import { PNG_1X1, drawingPasteFixture } from './drawing-image-paste-fixture.ts';

const PICTURES = '.docx-pages .docx-drawing-image';
const OVERLAY = '.docx-image-selection-overlay';
// Visible only: the demo page keeps its own hidden dialogs in the document.
const DIALOG = '[role="dialog"]:visible, [role="alertdialog"]:visible';

async function open(page: Page, port: number): Promise<void> {
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(PAINTED_PAGE, { timeout: 30_000 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open DOCX', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: 'drawing-paste.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: drawingPasteFixture(),
  });
  await expect(page.locator('.docx-pages [data-drawing-node-id]')).toHaveCount(3);
  await expect(page.locator(PICTURES)).toHaveCount(1);
}

/** Paste a PNG file on the focused element, as the browser does for a copied image. */
async function pasteImageFile(page: Page): Promise<boolean> {
  return page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }));
    const target = document.activeElement ?? document.body;
    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, PNG_1X1.toString('base64'));
}

const adapters = [
  {
    name: 'React',
    port: (metadata: Record<string, unknown>) => Number(metadata.reactPort ?? 5273),
  },
  { name: 'Vue', port: (metadata: Record<string, unknown>) => Number(metadata.vuePort ?? 5274) },
];

for (const adapter of adapters) {
  test.describe(`${adapter.name}: image file paste with a drawing selected`, () => {
    /** Select fixture drawing `index` with a press near its frame's corner. */
    async function press(page: Page, index: number) {
      // Inside a text box, a press places the caret in the box's text instead.
      await page
        .locator('.docx-pages [data-drawing-node-id]')
        .nth(index)
        .click({ position: { x: 3, y: 3 } });
      const overlay = page.locator(OVERLAY);
      await expect(overlay).toHaveCount(1);
      return overlay;
    }

    async function expectOnePastedPicture(page: Page) {
      expect(await pasteImageFile(page)).toBe(true);
      await expect(page.locator(PICTURES)).toHaveCount(2);
      // The selection ends, and the text takes the keyboard.
      await expect(page.locator(OVERLAY)).toHaveCount(0);
      expect(await page.evaluate(() => !!document.activeElement?.closest('.docx-pages'))).toBe(
        true
      );
      // No refusal dialog, and no second insert arrives late.
      await expect(page.locator(DIALOG)).toHaveCount(0);
      await page.waitForTimeout(500);
      await expect(page.locator(PICTURES)).toHaveCount(2);
    }

    for (const [index, kind] of ['picture', 'shape', 'text box'].entries()) {
      test(`inserts one picture from the focused overlay of a ${kind}`, async ({
        page,
      }, testInfo) => {
        await open(page, adapter.port(testInfo.config.metadata));
        const overlay = await press(page, index);
        await overlay.focus();
        await expect(overlay).toBeFocused();
        await expectOnePastedPicture(page);
        await page.keyboard.press('ControlOrMeta+z');
        await expect(page.locator(PICTURES)).toHaveCount(1);
      });
    }

    test('inserts one picture right after a press selects a drawing', async ({
      page,
    }, testInfo) => {
      await open(page, adapter.port(testInfo.config.metadata));
      // Whatever element the press leaves focused, the paste lands at the drawing.
      await press(page, 1);
      await expectOnePastedPicture(page);
    });

    test('inserts one picture at the caret in text', async ({ page }, testInfo) => {
      await open(page, adapter.port(testInfo.config.metadata));
      await page.locator('.docx-pages .layout-run', { hasText: 'Delta' }).click();
      await expect(page.locator(OVERLAY)).toHaveCount(0);
      expect(await pasteImageFile(page)).toBe(true);
      await expect(page.locator(PICTURES)).toHaveCount(2);
      await expect(page.locator(DIALOG)).toHaveCount(0);
      // No second insert arrives late.
      await page.waitForTimeout(500);
      await expect(page.locator(PICTURES)).toHaveCount(2);
    });
  });
}
