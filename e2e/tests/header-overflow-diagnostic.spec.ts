import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/header-with-table-and-paragraphs.docx';

test.describe.configure({ mode: 'serial' });

test('header grows after editing: typing extra lines does not produce body overlap', async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
    timeout: 15000,
  });

  const measure = async () =>
    page.evaluate(() => {
      const page1 = document.querySelector<HTMLElement>('[data-page-number="1"]');
      const header = page1?.querySelector<HTMLElement>('.layout-page-header');
      const body = page1?.querySelector<HTMLElement>('.layout-page-content');
      if (!header || !body) return null;
      return {
        headerBottom: header.getBoundingClientRect().bottom,
        bodyTop: body.getBoundingClientRect().top,
      };
    });

  const before = await measure();
  expect(before).not.toBeNull();

  // Enter the inline header editor and add several blank lines after the
  // existing content. This is the reproduction reported by users — typing
  // Enter a few times should grow the header and push body content down,
  // not produce overlap.
  await page.locator('.layout-page-header').first().dblclick();
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Enter');
    await page.keyboard.type('extra');
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  const after = await measure();
  expect(after).not.toBeNull();

  // Header is taller now → body must have moved down.
  expect(after!.headerBottom).toBeGreaterThan(before!.headerBottom);
  // No overlap: body top is at or below header bottom.
  expect(after!.bodyTop).toBeGreaterThanOrEqual(after!.headerBottom - 2);
});

test('diagnostic: tall header (paragraphs + table + paragraphs) does not overlap body', async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');

  // Wait for header table to render so the layout has settled.
  await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
    timeout: 15000,
  });

  const metrics = await page.evaluate(() => {
    const page1 = document.querySelector<HTMLElement>('[data-page-number="1"]');
    if (!page1) return null;
    const header = page1.querySelector<HTMLElement>('.layout-page-header');
    const body = page1.querySelector<HTMLElement>('.layout-page-content');
    if (!header || !body) return null;
    const headerRect = header.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const headerInner = header.firstElementChild as HTMLElement | null;
    const headerInnerRect = headerInner?.getBoundingClientRect();
    return {
      headerTop: headerRect.top,
      headerBottom: headerRect.bottom,
      headerHeight: headerRect.height,
      headerInnerHeight: headerInnerRect?.height ?? null,
      bodyTop: bodyRect.top,
      bodyText: body.textContent?.slice(0, 80) ?? '',
    };
  });

  expect(metrics).not.toBeNull();
  console.log('HEADER/BODY METRICS:', JSON.stringify(metrics, null, 2));

  // The body top must be at or below the header bottom — no overlap.
  // Allow a 2px tolerance for subpixel rounding.
  expect(metrics!.bodyTop).toBeGreaterThanOrEqual(metrics!.headerBottom - 2);

  // Sanity: actual rendered header content height should match the header
  // box height (the box should expand to fit the content, no clipping).
  if (metrics!.headerInnerHeight != null) {
    expect(metrics!.headerInnerHeight).toBeLessThanOrEqual(metrics!.headerHeight + 2);
  }
});
