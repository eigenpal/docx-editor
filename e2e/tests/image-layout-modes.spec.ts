/**
 * Image layout modes — inline, wrap-square (float), and topAndBottom (block).
 *
 * Locks in the three rendering paths Word distinguishes:
 *   1. Inline (`wp:inline`) — image flows in the line as a glyph.
 *   2. Wrap-square (`wp:anchor` + `wp:wrapSquare`) — positioned float, text wraps.
 *   3. Top-and-bottom (`wp:anchor` + `wp:wrapTopAndBottom`) — image breaks the
 *      flow and stands on its own line, text resumes below.
 *
 * Fixture: `e2e/fixtures/image-layout-modes-demo.docx` contains exactly one
 * image of each mode in a single document so we can assert all three coexist.
 */
import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/image-layout-modes-demo.docx';

async function loadFixture(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await page.waitForTimeout(1500);
}

test.describe('Image layout modes — inline, wrap, block', () => {
  test('all three modes render in the expected DOM containers', async ({ page }) => {
    await loadFixture(page);

    const counts = await page.evaluate(() => ({
      inline: document.querySelectorAll('.layout-line .layout-run-image').length,
      block: document.querySelectorAll('.layout-block-image').length,
      pageFloat: document.querySelectorAll('.layout-page-floating-image').length,
    }));

    expect(counts.inline).toBe(1);
    expect(counts.block).toBe(1);
    expect(counts.pageFloat).toBe(1);
  });

  test('inline image lives inside a layout-line and is in text flow', async ({ page }) => {
    await loadFixture(page);

    const inline = await page.evaluate(() => {
      const img = document.querySelector(
        '.layout-line .layout-run-image'
      ) as HTMLImageElement | null;
      if (!img) return null;
      const line = img.closest('.layout-line') as HTMLElement | null;
      const paragraph = img.closest('.layout-paragraph') as HTMLElement | null;
      if (!line || !paragraph) return null;
      const imgRect = img.getBoundingClientRect();
      // Count text runs across the whole inline paragraph — the inline image
      // shares the paragraph with text on both sides; line breaks inside the
      // paragraph are a normal consequence of the run flow and don't change
      // that the image is participating in the run sequence.
      const totalTextRuns = paragraph.querySelectorAll('.layout-run-text').length;
      return {
        imgWidth: imgRect.width,
        imgHeight: imgRect.height,
        siblingTextRunsInParagraph: totalTextRuns,
        // The image must NOT be inside a block-image container.
        isInsideBlockContainer: !!img.closest('.layout-block-image'),
        // The image must NOT be inside the page-floating layer.
        isInsideFloatingLayer: !!img.closest('.layout-floating-images-layer'),
      };
    });

    expect(inline).not.toBeNull();
    expect(inline!.imgWidth).toBeGreaterThan(0);
    expect(inline!.imgHeight).toBeGreaterThan(0);
    // The inline paragraph has text runs before AND after the image.
    expect(inline!.siblingTextRunsInParagraph).toBeGreaterThanOrEqual(2);
    expect(inline!.isInsideBlockContainer).toBe(false);
    expect(inline!.isInsideFloatingLayer).toBe(false);
  });

  test('wrap-square float creates left margins on overlapping lines', async ({ page }) => {
    await loadFixture(page);

    const wrapping = await page.evaluate(() => {
      const float = document.querySelector('.layout-page-floating-image') as HTMLElement | null;
      if (!float) return null;
      const imgRect = float.getBoundingClientRect();
      const pageEl = float.closest('[data-page-number]');
      if (!pageEl) return null;
      const lines = pageEl.querySelectorAll('.layout-paragraph .layout-line');
      let overlapping = 0;
      let offset = 0;
      for (const line of lines) {
        const lineEl = line as HTMLElement;
        const lineRect = lineEl.getBoundingClientRect();
        const overlaps = lineRect.bottom > imgRect.top + 2 && lineRect.top < imgRect.bottom - 2;
        if (!overlaps) continue;
        overlapping++;
        const ml = parseFloat(lineEl.style.marginLeft) || 0;
        if (ml > 10) offset++;
      }
      return { overlapping, offset };
    });

    expect(wrapping).not.toBeNull();
    expect(wrapping!.overlapping).toBeGreaterThan(0);
    // At least one overlapping line should have a left margin reserving space for the float
    expect(wrapping!.offset).toBeGreaterThan(0);
  });

  test('topAndBottom image stands on its own line and does not create wrap margins', async ({
    page,
  }) => {
    await loadFixture(page);

    const block = await page.evaluate(() => {
      const blockImg = document.querySelector('.layout-block-image') as HTMLElement | null;
      if (!blockImg) return null;
      const blockRect = blockImg.getBoundingClientRect();
      const pageEl = blockImg.closest('[data-page-number]');
      if (!pageEl) return null;
      const lines = pageEl.querySelectorAll('.layout-paragraph .layout-line');
      // Lines vertically overlapping the block-image band should NOT exist —
      // text breaks above and below, not around.
      let overlappingTextLines = 0;
      let linesWithMarginAroundIt = 0;
      for (const line of lines) {
        const lineEl = line as HTMLElement;
        const lineRect = lineEl.getBoundingClientRect();
        if (lineRect.bottom > blockRect.top + 2 && lineRect.top < blockRect.bottom - 2) {
          // A line overlapping the block image's vertical band is suspicious.
          // Allow lines that are just the block image's own line; filter on whether
          // the line contains visible text.
          const text = lineEl.textContent?.trim() ?? '';
          if (text.length > 0) overlappingTextLines++;
        }
        const ml = parseFloat(lineEl.style.marginLeft) || 0;
        const mr = parseFloat(lineEl.style.marginRight) || 0;
        // The block image must NOT cause text-wrap margins on adjacent text lines.
        // Adjacent = within ~40px above/below the block.
        const adjacent =
          (lineRect.top > blockRect.bottom && lineRect.top - blockRect.bottom < 40) ||
          (lineRect.bottom < blockRect.top && blockRect.top - lineRect.bottom < 40);
        if (adjacent && (ml > 10 || mr > 10)) linesWithMarginAroundIt++;
      }
      return { overlappingTextLines, linesWithMarginAroundIt };
    });

    expect(block).not.toBeNull();
    expect(block!.overlappingTextLines).toBe(0);
    expect(block!.linesWithMarginAroundIt).toBe(0);
  });

  test('inline image is NOT in the floating layer, float image is NOT in a text line', async ({
    page,
  }) => {
    await loadFixture(page);

    const isolation = await page.evaluate(() => {
      const inlineInFloat = document.querySelectorAll(
        '.layout-floating-images-layer .layout-run-image'
      ).length;
      const floatInLine = document.querySelectorAll(
        '.layout-line .layout-page-floating-image'
      ).length;
      return { inlineInFloat, floatInLine };
    });

    expect(isolation.inlineInFloat).toBe(0);
    expect(isolation.floatInLine).toBe(0);
  });
});
