import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

// Regression for #671: editing the footer must paint the caret (and any
// selection highlight) inside the footer, not the header. The bug was in
// core's `getHfDomSnapshot`, which resolved the active HF host with the
// combined `.layout-page-header, .layout-page-footer` selector — always the
// header (first in DOM order) — so the footer's caret resolved against the
// header's painted spans.
test.describe('HF caret follows the active section (#671)', () => {
  test('caret renders inside the footer, not the header', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page
      .locator('input[type="file"][accept=".docx"]')
      .setInputFiles('e2e/fixtures/section-inheritance-header-footer.docx');
    await page.waitForSelector('.layout-page-footer span[data-doc-from]', { timeout: 15000 });
    // Both regions must carry painted text so the header is a real shadow risk.
    await expect(page.locator('.layout-page-header span[data-doc-from]').first()).toBeVisible();

    // Engage footer edit mode and place a collapsed caret in the footer text.
    await page.locator('.layout-page-footer').first().dblclick();
    await expect(page.locator('.hf-inline-editor')).toHaveCount(1);
    await page.locator('.layout-page-footer span[data-doc-from]').first().click();

    // The blinking HF caret is a thin (width:2) blue div portalled near the
    // painter container. It's painted asynchronously (rAF / `painter:painted`
    // after the selection transaction), so poll until it appears and report
    // which region brackets it.
    const placement = await page
      .waitForFunction(
        () => {
          const caret = Array.from(
            document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')
          ).find((el) => {
            const bg = el.style.background || '';
            const w = parseFloat(el.style.width || '0');
            return /4285f4|66, 133, 244/i.test(bg) && w > 0 && w <= 3;
          });
          if (!caret) return null;
          const r = caret.getBoundingClientRect();
          const cy = r.top + r.height / 2;
          const within = (sel: string) =>
            Array.from(document.querySelectorAll<HTMLElement>(sel)).some((el) => {
              const b = el.getBoundingClientRect();
              return cy >= b.top - 2 && cy <= b.bottom + 2;
            });
          return {
            inFooter: within('.layout-page-footer'),
            inHeader: within('.layout-page-header'),
          };
        },
        { timeout: 5000 }
      )
      .then((handle) => handle.jsonValue());

    expect(placement.inFooter).toBe(true);
    expect(placement.inHeader).toBe(false);
  });

  // Regression: the caret stored viewport coords and re-converted to
  // host-local on every render. Scrolling fires unrelated re-renders (the
  // page indicator), which re-added the scroll delta, so the caret drifted
  // away from the footer as you scrolled. It must now stay glued.
  test('caret stays glued to the footer while scrolling', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page
      .locator('input[type="file"][accept=".docx"]')
      .setInputFiles('e2e/fixtures/section-inheritance-header-footer.docx');
    await page.waitForSelector('.layout-page-footer span[data-doc-from]', { timeout: 15000 });

    await page.locator('.layout-page-footer').first().dblclick();
    await expect(page.locator('.hf-inline-editor')).toHaveCount(1);
    await page.locator('.layout-page-footer span[data-doc-from]').first().click();

    // Helper: caret-top minus footer-top, in viewport space. Polls until the
    // caret exists so we don't race the async paint.
    const measureOffset = () =>
      page
        .waitForFunction(
          () => {
            const caret = Array.from(
              document.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')
            ).find((el) => {
              const bg = el.style.background || '';
              const w = parseFloat(el.style.width || '0');
              return /4285f4|66, 133, 244/i.test(bg) && w > 0 && w <= 3;
            });
            const footer = document.querySelector<HTMLElement>('.layout-page-footer');
            if (!caret || !footer) return null;
            return Math.round(
              caret.getBoundingClientRect().top - footer.getBoundingClientRect().top
            );
          },
          { timeout: 5000 }
        )
        .then((h) => h.jsonValue() as Promise<number>);

    const before = await measureOffset();

    // Scroll the editor's scroll container. Walk up from the painted pages to
    // the first scrollable ancestor (the demo nests the pages a few levels in).
    await page.evaluate(() => {
      let el: HTMLElement | null = document.querySelector('.paged-editor__pages');
      while (el) {
        const s = getComputedStyle(el);
        if (/auto|scroll/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2) {
          el.scrollTop += 300;
          return;
        }
        el = el.parentElement;
      }
    });
    // Let the scroll-driven re-render commit.
    await page.waitForTimeout(150);

    const after = await measureOffset();

    // The offset must be stable (small sub-pixel rounding tolerance), not grow
    // by the scroll delta.
    expect(Math.abs(after - before)).toBeLessThanOrEqual(3);
  });
});
