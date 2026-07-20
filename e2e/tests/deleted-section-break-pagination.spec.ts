import { expect, test } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('deleted section-break pagination', () => {
  test('does not start a new page for a section carrier whose paragraph mark is deleted', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 1100 });
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.loadDocxFile('fixtures/list-pagination-break.docx');

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const pages = Array.from(document.querySelectorAll('.layout-page'));
          const pageOf = (paraId: string) => {
            const paragraph = document.querySelector(
              `.layout-page-content [data-para-id="${paraId}"]`
            );
            const pageElement = paragraph?.closest('.layout-page');
            return pageElement ? pages.indexOf(pageElement) : -1;
          };
          const beforeDeletedBreak = pageOf('0173291B');
          const afterDeletedBreak = pageOf('584D913F');

          return (
            beforeDeletedBreak >= 0 &&
            afterDeletedBreak >= 0 &&
            beforeDeletedBreak === afterDeletedBreak
          );
        })
      )
      .toBe(true);
  });
});
