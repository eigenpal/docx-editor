import { expect, test } from '@playwright/test';
import { strToU8, zipSync } from 'fflate';

const PARA_ID = '1B4C77A2';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const filler = Array.from(
  { length: 140 },
  (_, i) => `<w:p><w:r><w:t>Paragraph ${i}</w:t></w:r></w:p>`
).join('');
const bytes = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>` +
      filler +
      `<w:p w14:paraId="${PARA_ID}"><w:r><w:t>External anchor target</w:t></w:r></w:p>` +
      '</w:body></w:document>'
  ),
});

for (const focus of ['editor', 'external'] as const) {
  test(`anchor scrolling preserves ${focus} focus and selection`, async ({ page }) => {
    await page.goto('http://localhost:5273/?e2e=1');
    await page.waitForFunction(() => window.__DOCX_EDITOR_E2E__?.ready() === true);
    await page.evaluate((data) => {
      window.__DOCX_EDITOR_E2E__!.getEditor()!.load(new Uint8Array(data));
    }, Array.from(bytes));
    await page.waitForFunction(() => window.__DOCX_EDITOR_E2E__?.ready() === true);

    const before = await page.evaluate((focus) => {
      const editor = window.__DOCX_EDITOR_E2E__!.getEditor()!;
      editor.setZoom(1.5);
      editor.focus();
      if (focus === 'external') {
        const input = document.createElement('input');
        input.id = 'external-reference-input';
        input.style.position = 'fixed';
        input.style.top = '0';
        document.body.append(input);
        input.focus();
      }
      document.activeElement!.setAttribute('data-anchor-focus', 'true');
      return editor.snapshot().selection;
    }, focus);

    expect(
      await page.evaluate(
        (paraId) => window.__DOCX_EDITOR_E2E__!.getEditor()!.scrollToAnchor({ paraId }),
        PARA_ID
      )
    ).toBe(true);

    const target = page.getByText('External anchor target', { exact: true });
    await expect(target).toBeInViewport({ ratio: 1 });
    // Let native selection and scroll events settle before checking preservation.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        })
    );
    await expect(target).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-anchor-focus="true"]')).toBeFocused();
    expect(
      await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.getEditor()!.snapshot().selection)
    ).toEqual(before);

    const geometry = await target.evaluate((element) => {
      const target = element.getBoundingClientRect();
      const scroller = element.closest('.docx-editor__scroll-container')!;
      const viewport = scroller.getBoundingClientRect();
      return {
        top: target.top,
        bottom: target.bottom,
        viewportTop: viewport.top,
        viewportBottom: viewport.bottom,
        scrollTop: scroller.scrollTop,
      };
    });
    expect(geometry.scrollTop).toBeGreaterThan(0);
    expect(geometry.top).toBeGreaterThanOrEqual(geometry.viewportTop);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportBottom);
  });
}
