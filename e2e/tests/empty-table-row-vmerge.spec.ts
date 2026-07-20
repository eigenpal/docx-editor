import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/empty-table-row-vmerge.docx';

async function loadFixture(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await editor.loadDocxFile(FIXTURE);
  await page.waitForSelector('.layout-table');
  await page.waitForSelector('.layout-table-row[data-row-index="1"] .layout-table-cell');
}

test.describe('empty table row from vertical merge continuations', () => {
  test('loads the synthetic continuation-row fixture without a tableRow schema error', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') {
        pageErrors.push(message.text());
      }
    });

    await loadFixture(page);

    const paintedPage = page.locator('.layout-page-content').first();
    await expect(paintedPage.getByText('Synthetic Vertical Merge Table')).toBeVisible();
    await expect(paintedPage.getByText('Row after merge A')).toBeVisible();

    const rowCellCounts = await page
      .locator('.layout-table')
      .first()
      .locator('.layout-table-row')
      .evaluateAll((rows) =>
        rows.map((row) => row.querySelectorAll(':scope > .layout-table-cell').length)
      );

    expect(rowCellCounts).toEqual([2, 2, 2]);
    expect(pageErrors.filter((message) => !message.includes('favicon'))).toEqual([]);
  });
});
