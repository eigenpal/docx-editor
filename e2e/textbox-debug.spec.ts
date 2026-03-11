import { test } from '@playwright/test';
import { EditorPage } from './helpers/editor-page';

test('screenshot textbox-test.docx rendering', async ({ page }) => {
  const editorPage = new EditorPage(page);
  await editorPage.goto();
  await editorPage.waitForReady();
  await editorPage.loadDocxFile('fixtures/textbox-test.docx');
  await page.waitForTimeout(2000);

  // Check layout-textbox elements in visible pages
  const layoutInfo = await page.evaluate(() => {
    const pagesArea = document.querySelector('.paged-editor__pages');
    if (!pagesArea) return { error: 'No pages area found' };

    const layoutTextboxes = pagesArea.querySelectorAll('.layout-textbox');
    const allFragments = pagesArea.querySelectorAll('[class*="layout-"]');

    return {
      layoutTextboxCount: layoutTextboxes.length,
      allFragmentClasses: Array.from(allFragments)
        .slice(0, 20)
        .map((el) => ({
          className: el.className,
          tagName: el.tagName,
          style: (el as HTMLElement).getAttribute('style')?.substring(0, 200),
          size: {
            w: (el as HTMLElement).getBoundingClientRect().width,
            h: (el as HTMLElement).getBoundingClientRect().height,
          },
        })),
      // Check what fragment types exist
      fragmentKinds: Array.from(pagesArea.querySelectorAll('[data-block-id]'))
        .map((el) => ({
          blockId: (el as HTMLElement).dataset.blockId,
          className: el.className,
          tagName: el.tagName,
        }))
        .slice(0, 30),
      // Raw HTML of first page (truncated)
      firstPageHTML: (pagesArea.children[0] as HTMLElement)?.innerHTML?.substring(0, 3000),
    };
  });

  console.log('Layout textbox count:', layoutInfo.layoutTextboxCount);
  console.log('Fragment kinds:', JSON.stringify(layoutInfo.fragmentKinds, null, 2));

  if (layoutInfo.allFragmentClasses) {
    for (const f of layoutInfo.allFragmentClasses) {
      console.log(`  Fragment: ${f.tagName}.${f.className} (${f.size.w}x${f.size.h})`);
    }
  }

  // Dump raw HTML
  if (layoutInfo.firstPageHTML) {
    console.log('\nFirst page HTML (truncated):', layoutInfo.firstPageHTML);
  }

  const pages = page.locator('.paged-editor__pages');
  if ((await pages.count()) > 0) {
    await pages.screenshot({ path: 'screenshots/textbox-test-pages.png' });
  }
});
