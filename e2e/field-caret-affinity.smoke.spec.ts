import { expect, test } from '@playwright/test';
import {
  FIELD_AFFINITY_RESULTS,
  fieldAffinityDocument,
} from '../packages/core/src/editor/__tests__/fixtures/field-affinity-document';

test.use({ viewport: { width: 1600, height: 1200 } });
for (const [adapter, port] of [
  ['react', 5273],
  ['vue', 5274],
] as const) {
  for (const [label, result] of FIELD_AFFINITY_RESULTS) {
    test(`${adapter}: field click keeps its middle line, ${label}`, async ({ page }) => {
      await page.route('**/field-affinity.docx', (route) =>
        route.fulfill({
          body: Buffer.from(fieldAffinityDocument(result)),
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
      );
      await page.goto(`http://localhost:${port}/?fixture=field-affinity.docx`);
      const pages = page.locator('.docx-pages').first();
      await expect(pages).toContainText(label === 'hard breaks' ? 'bbb' : 'ABCDE', {
        timeout: 45_000,
      });
      const lines = pages.locator('.docx-line').filter({ has: page.locator('[data-docx-field]') });
      expect(await lines.count()).toBeGreaterThanOrEqual(3);
      const middle = lines.nth(1);
      const lineId = await middle.getAttribute('data-line-id');
      const field = middle.locator('[data-docx-field]').first();
      const before = await pages.textContent();
      for (const fraction of [0.2, 0.8]) {
        const box = (await field.boundingBox())!;
        await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
        await expect
          .poll(() =>
            page.evaluate(() => {
              const node = document.getSelection()?.focusNode;
              const element =
                node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
              return (element?.closest('[data-line-id]') as HTMLElement | null)?.dataset.lineId;
            })
          )
          .toBe(lineId);
        const caret = await pages.locator('[data-docx-caret]').boundingBox();
        expect(Boolean(caret)).toBe(true);
        expect(Math.abs(caret!.x - (fraction < 0.5 ? box.x : box.x + box.width))).toBeLessThan(3);
        expect(Math.abs(caret!.y - box.y)).toBeLessThan(3);
      }
      expect(await pages.textContent()).toBe(before);
      await page.keyboard.type('Z');
      await expect.poll(() => pages.textContent()).toBe(before + 'Z');
      await page.keyboard.press('Control+z');
      await expect.poll(() => pages.textContent()).toBe(before);
      await page.keyboard.press('Control+y');
      await expect.poll(() => pages.textContent()).toBe(before + 'Z');
    });
  }
}
