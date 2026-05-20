import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/header-right-tab.docx';

/**
 * Regression: this header is a logo, a right (`end`) tab stop, then bold text
 * and a `{project_name}` variable. Word — and the editable header view —
 * keep it on one line because the right tab aligns the text's right edge to
 * the stop. The painter's measurer used to treat every tab as a left tab,
 * measure the line as `stopPx + textWidth`, overflow the content width, and
 * wrap the header onto two lines.
 */
test('header with a right tab stop renders on a single line', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await page.waitForSelector('.layout-page-header .layout-line');

  const firstHeader = page.locator('[data-page-number="1"] .layout-page-header');
  const lineCount = await firstHeader.locator('.layout-line').count();
  expect(lineCount).toBe(1);

  // The header text and the variable share that one line.
  const headerText = await firstHeader.innerText();
  expect(headerText).toContain('CREDIT PROPOSAL');
  expect(headerText).toContain('{project_name}');
});

/**
 * Regression: the header line is a tall inline logo plus short 8pt text.
 * Word seats an inline image on the text baseline, so the label hugs the
 * paragraph's bottom border. The painter used to inflate the line-height
 * (imageH + 2*descent) and `vertical-align: middle` the image, which centred
 * the short text in the band — leaving it floating ~16px above the border
 * while the editable header view rendered it correctly. The painter now
 * baseline-aligns the row so the static and editable renders match.
 */
test('header logo line baseline-aligns the label with the image bottom', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await editor.loadDocxFile(FIXTURE);
  await page.waitForSelector('.layout-page-header .layout-line');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.layout-page-header .layout-paragraph')].some(
      (p) => p.textContent?.includes('INTERNAL RESTRICTED') && p.querySelector('img')
    )
  );

  const metrics = await page.evaluate(() => {
    const para = [...document.querySelectorAll('.layout-page-header .layout-paragraph')].find(
      (p) => p.textContent?.includes('INTERNAL RESTRICTED') && p.querySelector('img')
    )!;
    const line = para.querySelector('.layout-line')!;
    const img = para.querySelector('img')!;
    const textSpan = para.querySelector('.layout-run-text')!;
    const range = document.createRange();
    range.selectNodeContents(textSpan);
    const lineBottom = line.getBoundingClientRect().bottom;
    return {
      textGapToLineBottom: lineBottom - range.getBoundingClientRect().bottom,
      imageGapToLineBottom: lineBottom - img.getBoundingClientRect().bottom,
    };
  });

  // Both the label glyphs and the logo sit on the baseline near the border —
  // a few px, not the ~16px the centred render produced.
  expect(metrics.textGapToLineBottom).toBeLessThanOrEqual(4);
  expect(metrics.imageGapToLineBottom).toBeLessThanOrEqual(4);
  // ...and the label is not floating above the logo: their bottoms are close.
  expect(Math.abs(metrics.textGapToLineBottom - metrics.imageGapToLineBottom)).toBeLessThanOrEqual(
    5
  );
});

/**
 * Regression: the same header with the inline logo's `wp:inline` distT/distB
 * wrap distances set to 0.2" (182880 EMU ≈ 19px) each. Per ECMA-376 those
 * distances reserve vertical space around an inline image. The painter used
 * to ignore distT/distB on inline images (only the topAndBottom block path
 * read them), so the line stayed image-height tall and the logo's spacing
 * was lost. The line height now folds them in and the image carries them as
 * top/bottom margins.
 */
test('inline image distT/distB inflate the header line height', async ({ page }) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();

  await editor.loadDocxFile('fixtures/header-inline-image-dist.docx');
  await page.waitForSelector('.layout-page-header .layout-line');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.layout-page-header .layout-paragraph')].some(
      (p) => p.textContent?.includes('INTERNAL RESTRICTED') && p.querySelector('img')
    )
  );

  const metrics = await page.evaluate(() => {
    const para = [...document.querySelectorAll('.layout-page-header .layout-paragraph')].find(
      (p) => p.textContent?.includes('INTERNAL RESTRICTED') && p.querySelector('img')
    )!;
    const line = para.querySelector('.layout-line')!;
    const img = para.querySelector('img')!;
    return {
      lineHeight: line.getBoundingClientRect().height,
      imageHeight: img.getBoundingClientRect().height,
      imageMarginTop: parseFloat(getComputedStyle(img).marginTop),
      imageMarginBottom: parseFloat(getComputedStyle(img).marginBottom),
    };
  });

  // distT + distB ≈ 38px of reserved space — the line is well past the bare
  // image height (~43px) it would be if the distances were dropped.
  expect(metrics.lineHeight).toBeGreaterThan(metrics.imageHeight + 30);
  // ...applied as the image's own margins (~19px each).
  expect(metrics.imageMarginTop).toBeGreaterThan(10);
  expect(metrics.imageMarginBottom).toBeGreaterThan(10);
});
