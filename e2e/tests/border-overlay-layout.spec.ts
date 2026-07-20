/**
 * Border overlay layout regression.
 *
 * Fixture uses generated text/artwork to exercise:
 * - behindDoc wrapNone decorative anchors
 * - indented paragraph border around the title
 * - text-relative double page border
 */
import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/border-overlay-layout-demo.docx';

async function loadFixture(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await page.waitForTimeout(1500);
}

test.describe('Border overlay layout', () => {
  test('title and page borders render with Word-style inset geometry', async ({ page }) => {
    await loadFixture(page);

    const metrics = await page.evaluate(() => {
      const pageEl = document.querySelector<HTMLElement>('[data-page-number="1"]');
      const contentEl = pageEl?.querySelector<HTMLElement>('.layout-page-content');
      const pageBorder = pageEl?.querySelector<HTMLElement>('.layout-page-border');
      const titleParagraph = Array.from(
        pageEl?.querySelectorAll<HTMLElement>('.layout-paragraph') ?? []
      ).find((el) => el.textContent?.includes('CENTERED BORDER TITLE'));
      const titleBorder = titleParagraph?.querySelector<HTMLElement>('.layout-paragraph-border');

      if (!pageEl || !contentEl || !pageBorder || !titleParagraph || !titleBorder) return null;

      const pageRect = pageEl.getBoundingClientRect();
      const contentRect = contentEl.getBoundingClientRect();
      const pageBorderRect = pageBorder.getBoundingClientRect();
      const titleBorderRect = titleBorder.getBoundingClientRect();

      return {
        floatingImages: pageEl.querySelectorAll('.layout-page-floating-image').length,
        pageBorderInsetLeft: Math.round(pageBorderRect.left - pageRect.left),
        pageBorderInsetTop: Math.round(pageBorderRect.top - pageRect.top),
        pageBorderWidth: Math.round(pageBorderRect.width),
        pageWidth: Math.round(pageRect.width),
        contentInsetLeft: Math.round(contentRect.left - pageRect.left),
        contentInsetTop: Math.round(contentRect.top - pageRect.top),
        titleBorderWidth: Math.round(titleBorderRect.width),
        contentWidth: Math.round(contentRect.width),
        titleBorderLeft: Math.round(titleBorderRect.left - contentRect.left),
        pageBorderKind: pageBorder.style.borderTopStyle,
        pageBorderCssWidth: pageBorder.style.borderTopWidth,
      };
    });

    expect(metrics).not.toBeNull();
    expect(metrics!.floatingImages).toBe(2);
    expect(metrics!.pageBorderInsetLeft).toBeGreaterThan(20);
    expect(metrics!.pageBorderInsetTop).toBeGreaterThan(20);
    expect(metrics!.pageBorderInsetLeft).toBeLessThan(metrics!.contentInsetLeft);
    expect(metrics!.pageBorderInsetTop).toBeLessThan(metrics!.contentInsetTop);
    expect(metrics!.pageBorderWidth).toBeLessThan(metrics!.pageWidth - 40);
    expect(metrics!.pageBorderKind).toBe('double');
    expect(metrics!.pageBorderCssWidth).toBe('3px');
    expect(metrics!.titleBorderLeft).toBeGreaterThan(180);
    expect(metrics!.titleBorderWidth).toBeLessThan(metrics!.contentWidth * 0.55);
  });
});
