import { pictureCompositionFixture } from './empty-line-composition-fixture.ts';
import { expect, test } from '@playwright/test';

// CDP exercises Chromium composition and geometry. It does not open a native IME candidate window.
test('empty paragraph composition has visible preedit text and native caret geometry', async ({
  page,
}, testInfo) => {
  const port = testInfo.config.metadata.reactPort ?? 5273;
  await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const line = page.locator('.layout-line').first();
  await expect(line).toBeAttached();
  const bounds = await line.boundingBox();
  if (!bounds) throw new Error('Missing empty paragraph');
  await page.mouse.click(bounds.x + 2, bounds.y + bounds.height / 2);
  const before = await page.locator('.docx-editor-one-surface__caret').boundingBox();
  expect(before).not.toBeNull();
  const client = await page.context().newCDPSession(page);
  await client.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
  const preedit = await page.evaluate(() => {
    const selection = document.getSelection()!;
    const range = selection.getRangeAt(0).getBoundingClientRect();
    const parent = selection.anchorNode!.parentElement!;
    return {
      text: parent.textContent,
      fontSize: parseFloat(getComputedStyle(parent).fontSize),
      x: range.x,
      y: range.y,
      height: range.height,
    };
  });
  expect(preedit.text).toBe('ni');
  expect(preedit.fontSize).toBeGreaterThan(0);
  expect(preedit.height).toBeGreaterThan(0);
  expect(preedit.x).toBeGreaterThan(before!.x);
  expect(Math.abs(preedit.y - before!.y)).toBeLessThan(4);
  await client.send('Input.insertText', { text: '你' });
  await expect(page.locator('.layout-run')).toHaveText('你');
  await page.getByRole('button', { name: /^Undo \(/ }).click();
  await expect(page.locator('.layout-run')).toHaveCount(0);
  await page.getByRole('button', { name: /^Redo \(/ }).click();
  await expect(page.locator('.layout-run')).toHaveText('你');
});

for (const align of ['left', 'center'] as const) {
  for (const side of ['before', 'after'] as const) {
    test(`${align} drawing-only line supports composition ${side} the picture`, async ({
      page,
    }, testInfo) => {
      const port = testInfo.config.metadata.reactPort ?? 5273;
      await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Open DOCX' }).click();
      await (
        await chooser
      ).setFiles({
        name: 'composition.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: pictureCompositionFixture(align),
      });
      const picture = page.locator('.docx-drawing-image');
      await expect(picture).toBeVisible();
      const original = await picture.boundingBox();
      if (!original) throw new Error('Missing inline picture');
      const zeroFontBox = await picture.evaluate((image) => {
        const line = image.closest<HTMLElement>('.layout-line')!;
        const font = line.style.fontSize;
        line.style.fontSize = '0';
        const box = image.getBoundingClientRect().toJSON();
        line.style.fontSize = font;
        return box;
      });
      expect(original.x).toBeCloseTo(zeroFontBox.x, 3);
      expect(original.y).toBeCloseTo(zeroFontBox.y, 3);
      await page.mouse.click(
        side === 'before' ? original.x - 2 : original.x + original.width + 2,
        original.y + original.height - 2
      );
      const caret = await page.locator('.docx-editor-one-surface__caret').boundingBox();
      expect(caret).not.toBeNull();
      expect(caret!.x).toBeCloseTo(side === 'before' ? original.x : original.x + original.width, 0);
      const client = await page.context().newCDPSession(page);
      await client.send('Input.imeSetComposition', {
        text: 'ni',
        selectionStart: 2,
        selectionEnd: 2,
      });
      const preedit = await page.evaluate(() => {
        const selection = document.getSelection()!;
        const parent = selection.anchorNode!.parentElement!;
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        return {
          fontSize: getComputedStyle(parent).fontSize,
          fontFamily: getComputedStyle(parent).fontFamily,
          y: rect.y,
          height: rect.height,
        };
      });
      expect(preedit.fontSize).toBe('24px');
      expect(preedit.fontFamily).toContain('Arial');
      expect(preedit.height).toBeGreaterThan(0);
      // The engine caret spans the picture; native text sits at the picture baseline.
      expect(preedit.y).toBeGreaterThanOrEqual(caret!.y);
      expect(preedit.y).toBeLessThan(caret!.y + caret!.height);
      const composedPicture = await picture.boundingBox();
      expect(composedPicture!.y).toBeCloseTo(original.y, 3);
      await client.send('Input.insertText', { text: '你' });
      await expect(page.locator('.layout-run')).toHaveText('你');
      await expect(picture).toHaveCount(1);
      await page.getByRole('button', { name: /^Undo \(/ }).click();
      await expect(page.locator('.layout-run')).toHaveCount(0);
      expect((await picture.boundingBox())!.y).toBeCloseTo(original.y, 3);
    });
  }
}
