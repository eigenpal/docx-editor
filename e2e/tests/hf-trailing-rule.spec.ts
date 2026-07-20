import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/template-with-hf-rule.docx';

test('header trailing empty paragraph with pBdr.bottom renders the horizontal rule', async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await page.waitForFunction(
    () => document.querySelectorAll('.layout-page-header [data-from-row]').length > 0,
    { timeout: 15000 }
  );

  const ruleInfo = await page.evaluate(() => {
    const headers = document.querySelectorAll<HTMLElement>('.layout-page-header');
    const results: Array<{
      pageHeaderRect: DOMRect;
      paragraphs: Array<{
        rect: DOMRect;
        runs: number;
        borderBottom: string;
      }>;
    }> = [];
    headers.forEach((h) => {
      const paragraphs = h.querySelectorAll<HTMLElement>('.layout-paragraph');
      const data: (typeof results)[number]['paragraphs'] = [];
      paragraphs.forEach((p) => {
        // Painter draws pBdr on `.layout-paragraph-border`, not the paragraph
        // element's own border box.
        const borderBox = p.querySelector<HTMLElement>('.layout-paragraph-border');
        data.push({
          rect: p.getBoundingClientRect(),
          runs: p.querySelectorAll('[data-doc-from]').length,
          borderBottom: borderBox
            ? getComputedStyle(borderBox).borderBottomWidth
            : getComputedStyle(p).borderBottomWidth,
        });
      });
      results.push({ pageHeaderRect: h.getBoundingClientRect(), paragraphs: data });
    });
    return results;
  });

  console.log(JSON.stringify(ruleInfo, null, 2));

  expect(ruleInfo.length).toBeGreaterThan(0);
  const headerOne = ruleInfo[0];
  // The trailing empty paragraph (no runs) should have a non-zero bottom border.
  const trailing = headerOne.paragraphs.find((p) => p.runs === 0);
  expect(trailing).toBeDefined();
  expect(parseFloat(trailing!.borderBottom)).toBeGreaterThan(0);
});
