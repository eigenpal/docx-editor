import { expect, test, type Page } from '@playwright/test';

const VUE_URL = process.env.VUE_E2E_URL ?? 'http://localhost:5174/?e2e=1';

async function loadVueFixture(page: Page, fixture: string): Promise<void> {
  await page.goto(VUE_URL);
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();
  await page.locator('input[type="file"]').first().setInputFiles(`e2e/fixtures/${fixture}`);
  await page.locator('[data-page-number="1"]').waitFor();
}

test.describe('Vue rendering parity', () => {
  test('uses the first-page header and footer when w:titlePg is enabled', async ({ page }) => {
    await loadVueFixture(page, 'titlePg-header-footer.docx');

    const firstHeader = page.locator('[data-page-number="1"] .layout-page-header');
    const firstFooter = page.locator('[data-page-number="1"] .layout-page-footer');

    await expect(firstHeader.locator('img')).toHaveCount(1);
    await expect(firstHeader).not.toContainText('Second header onwards');
    await expect(firstFooter).toContainText('Some address');
    await expect(firstFooter).toContainText('phone');
  });

  test('paints authored header distance including an explicit zero', async ({ page }) => {
    await loadVueFixture(page, 'issue-740-header-zero-distance.docx');

    await expect
      .poll(() =>
        page.evaluate(() => {
          const pageEl = document.querySelector<HTMLElement>('[data-page-number="1"]');
          const header = pageEl?.querySelector<HTMLElement>('.layout-page-header');
          if (!pageEl || !header) return null;
          return Math.round(
            header.getBoundingClientRect().top - pageEl.getBoundingClientRect().top
          );
        })
      )
      .toBe(0);
  });

  test('paints authored page borders', async ({ page }) => {
    await loadVueFixture(page, 'border-overlay-layout-demo.docx');

    const pageBorder = page.locator('[data-page-number="1"] .layout-page-border');
    await expect(pageBorder).toHaveCount(1);
    await expect
      .poll(() => pageBorder.evaluate((element) => element.style.borderTopStyle))
      .toBe('double');
    await expect
      .poll(() => pageBorder.evaluate((element) => element.style.borderTopWidth))
      .toBe('3px');
  });

  test('paints table borders inside headers', async ({ page }) => {
    await loadVueFixture(page, 'header-with-table.docx');

    const cells = page.locator('.layout-page-header .layout-table-cell');
    await expect(cells).toHaveCount(2);

    const borders = await cells.evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          topStyle: style.borderTopStyle,
          topWidth: Number.parseFloat(style.borderTopWidth),
          bottomStyle: style.borderBottomStyle,
          bottomWidth: Number.parseFloat(style.borderBottomWidth),
        };
      })
    );

    for (const border of borders) {
      expect(border.topStyle).toBe('solid');
      expect(border.topWidth).toBeGreaterThan(0);
      expect(border.bottomStyle).toBe('solid');
      expect(border.bottomWidth).toBeGreaterThan(0);
    }
  });
});
