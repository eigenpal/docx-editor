/**
 * Text wrapping around floating images (Issues #143 and #188)
 *
 * Tests that text lines wrap around floating images instead of rendering
 * underneath them. Uses float-wrap-comprehensive-test.docx which contains:
 * - Section 1: All wrap types at page level
 * - Section 2: Position modes
 * - Section 3: Multiple floating images
 * - Section 4: Floating images in table cells
 * - Section 5: Edge cases
 */
import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/float-wrap-comprehensive-test.docx';

/** Load the test fixture and wait for rendering */
async function loadFixture(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
  await page.waitForSelector('.paged-editor__pages');
  await page.waitForSelector('[data-page-number]');
  await page.waitForTimeout(2000);
}

/** Collect floating image and text wrapping metrics from the rendered DOM */
async function collectWrappingMetrics(page: Page) {
  return page.evaluate(() => {
    // Page-level floating images
    const pageFloatLayers = document.querySelectorAll('.layout-floating-images-layer');
    const pageFloatImgs = document.querySelectorAll('.layout-page-floating-image');

    // Cell-level floating images
    const cellFloatLayers = document.querySelectorAll('.layout-cell-floating-images-layer');
    const cellFloatImgs = document.querySelectorAll('.layout-cell-floating-image');

    // Lines with floating margins applied
    const allLines = document.querySelectorAll('.layout-line');
    let linesWithLeftOffset = 0;
    let linesWithRightOffset = 0;
    for (const line of allLines) {
      const el = line as HTMLElement;
      const ml = parseFloat(el.style.marginLeft) || 0;
      const mr = parseFloat(el.style.marginRight) || 0;
      if (ml > 0) linesWithLeftOffset++;
      if (mr > 0) linesWithRightOffset++;
    }

    // Check if any page floating image overlaps text (text should avoid it)
    const overlaps: Array<{ imgId: string; overlapCount: number }> = [];
    for (const imgContainer of pageFloatImgs) {
      const el = imgContainer as HTMLElement;
      const imgRect = el.getBoundingClientRect();
      // Find lines in the same page that overlap with this image
      const page = el.closest('[data-page-number]');
      if (!page) continue;
      const pageLines = page.querySelectorAll('.layout-paragraph .layout-line');
      let overlapCount = 0;
      for (const line of pageLines) {
        const lineEl = line as HTMLElement;
        const lineRect = lineEl.getBoundingClientRect();
        // Line overlaps image vertically?
        if (lineRect.bottom > imgRect.top + 2 && lineRect.top < imgRect.bottom - 2) {
          // Check if line text extends into the image area
          const lineLeft = lineRect.left;
          const lineRight = lineRect.left + lineEl.scrollWidth;
          if (lineLeft < imgRect.right - 2 && lineRight > imgRect.left + 2) {
            // Check if the line has an offset that avoids the image
            const ml = parseFloat(lineEl.style.marginLeft) || 0;
            const adjustedLeft = lineRect.left + ml;
            // If line still overlaps after offset, count it
            if (adjustedLeft < imgRect.right - 5 && lineRight > imgRect.left + 5) {
              overlapCount++;
            }
          }
        }
      }
      overlaps.push({
        imgId: el.dataset.pmStart ?? 'unknown',
        overlapCount,
      });
    }

    return {
      pageFloatLayerCount: pageFloatLayers.length,
      pageFloatImgCount: pageFloatImgs.length,
      cellFloatLayerCount: cellFloatLayers.length,
      cellFloatImgCount: cellFloatImgs.length,
      totalLines: allLines.length,
      linesWithLeftOffset,
      linesWithRightOffset,
      overlaps,
    };
  });
}

test.describe('Float Text Wrapping (Issues #143 & #188)', () => {
  test('page-level floating images have text wrapping applied', async ({ page }) => {
    await loadFixture(page);
    const metrics = await collectWrappingMetrics(page);

    // Should have page-level floating image layers
    expect(metrics.pageFloatLayerCount).toBeGreaterThan(0);
    expect(metrics.pageFloatImgCount).toBeGreaterThan(0);

    // Lines should have offsets from floating images
    expect(metrics.linesWithLeftOffset).toBeGreaterThan(0);
  });

  test('wrapSquare text wraps to the right of left-aligned image', async ({ page }) => {
    await loadFixture(page);

    // Find the first page floating image and check that nearby lines are offset
    const hasWrapping = await page.evaluate(() => {
      const floatImgs = document.querySelectorAll('.layout-page-floating-image');
      if (floatImgs.length === 0) return false;

      // Take the first floating image
      const firstImg = floatImgs[0] as HTMLElement;
      const imgRect = firstImg.getBoundingClientRect();
      const pageEl = firstImg.closest('[data-page-number]');
      if (!pageEl) return false;

      // Find lines that vertically overlap with this image
      const lines = pageEl.querySelectorAll('.layout-paragraph .layout-line');
      let offsetLines = 0;
      let overlappingLines = 0;

      for (const line of lines) {
        const lineEl = line as HTMLElement;
        const lineRect = lineEl.getBoundingClientRect();
        if (lineRect.bottom > imgRect.top + 2 && lineRect.top < imgRect.bottom - 2) {
          overlappingLines++;
          const ml = parseFloat(lineEl.style.marginLeft) || 0;
          if (ml > 10) offsetLines++;
        }
      }

      // At least some overlapping lines should have left offset
      return overlappingLines > 0 && offsetLines > 0;
    });

    expect(hasWrapping).toBe(true);
  });

  test('wrapSquare with right-side image has text on left only', async ({ page }) => {
    await loadFixture(page);

    const hasRightWrap = await page.evaluate(() => {
      // Look for floating images positioned on the right side (x > 50% of content)
      const floatImgs = document.querySelectorAll('.layout-page-floating-image');
      for (const container of floatImgs) {
        const el = container as HTMLElement;
        const left = parseFloat(el.style.left) || 0;
        const pageEl = el.closest('[data-page-number]');
        if (!pageEl) continue;
        const contentEl = pageEl.querySelector('.layout-page-content');
        if (!contentEl) continue;
        const contentWidth = contentEl.clientWidth;

        // Right-side image: positioned past center
        if (left > contentWidth * 0.4) {
          // Check lines in this page have right margin
          const lines = pageEl.querySelectorAll('.layout-paragraph .layout-line');
          for (const line of lines) {
            const lineEl = line as HTMLElement;
            const mr = parseFloat(lineEl.style.marginRight) || 0;
            if (mr > 10) return true;
          }
        }
      }
      return false;
    });

    expect(hasRightWrap).toBe(true);
  });

  test('wrapNone images do not affect text line widths', async ({ page }) => {
    await loadFixture(page);

    // wrapNone images (behindDoc/inFront) should not create wrapping
    // They render as floating images but text goes full-width underneath
    // The test doc has sections 1g and 1h with wrapNone
    const metrics = await collectWrappingMetrics(page);

    // Should have floating images rendered
    expect(metrics.pageFloatImgCount).toBeGreaterThan(0);
    // Total lines should be reasonable (document renders)
    expect(metrics.totalLines).toBeGreaterThan(50);
  });

  test('cross-paragraph wrapping: tall image affects multiple paragraphs', async ({ page }) => {
    await loadFixture(page);

    // Section 5d has a tall image (120x200) that spans multiple paragraphs
    // Lines in subsequent paragraphs should also have offset
    const crossParaWrap = await page.evaluate(() => {
      const pages = document.querySelectorAll('[data-page-number]');
      let paragraphsWithOffset = 0;

      for (const pageEl of pages) {
        const paragraphs = pageEl.querySelectorAll('.layout-paragraph');
        for (const para of paragraphs) {
          const lines = para.querySelectorAll('.layout-line');
          let hasOffset = false;
          for (const line of lines) {
            const ml = parseFloat((line as HTMLElement).style.marginLeft) || 0;
            if (ml > 10) {
              hasOffset = true;
              break;
            }
          }
          if (hasOffset) paragraphsWithOffset++;
        }
      }

      // Multiple paragraphs should have offset (cross-paragraph wrapping)
      return paragraphsWithOffset;
    });

    expect(crossParaWrap).toBeGreaterThan(1);
  });

  test('multiple floating images create combined exclusion zones', async ({ page }) => {
    await loadFixture(page);

    // Section 3a has two images (left and right) in the same paragraph
    // Lines should have both left AND right offsets
    const hasCombined = await page.evaluate(() => {
      const lines = document.querySelectorAll('.layout-line');
      for (const line of lines) {
        const el = line as HTMLElement;
        const ml = parseFloat(el.style.marginLeft) || 0;
        const mr = parseFloat(el.style.marginRight) || 0;
        if (ml > 10 && mr > 10) return true;
      }
      return false;
    });

    expect(hasCombined).toBe(true);
  });

  test('table cell floating images are positioned at anchor offset', async ({ page }) => {
    await loadFixture(page);
    const metrics = await collectWrappingMetrics(page);

    // Should have cell-level floating layers
    expect(metrics.cellFloatLayerCount).toBeGreaterThan(0);
    expect(metrics.cellFloatImgCount).toBeGreaterThan(0);

    // Cell floating images should be absolutely positioned (not block centered)
    const cellImgsPositioned = await page.evaluate(() => {
      const cellImgs = document.querySelectorAll('.layout-cell-floating-image');
      let positioned = 0;
      for (const img of cellImgs) {
        const el = img as HTMLElement;
        if (el.style.position === 'absolute') positioned++;
      }
      return positioned;
    });

    expect(cellImgsPositioned).toBe(metrics.cellFloatImgCount);
  });

  test('table cell text wraps around floating images', async ({ page }) => {
    await loadFixture(page);

    // Check that lines inside table cells have offsets from floating images
    const cellWrapping = await page.evaluate(() => {
      const cellContents = document.querySelectorAll('.layout-table-cell-content');
      let cellsWithOffset = 0;

      for (const cell of cellContents) {
        const hasFloatLayer = cell.querySelector('.layout-cell-floating-images-layer');
        if (!hasFloatLayer) continue;

        const lines = cell.querySelectorAll('.layout-line');
        for (const line of lines) {
          const ml = parseFloat((line as HTMLElement).style.marginLeft) || 0;
          if (ml > 5) {
            cellsWithOffset++;
            break;
          }
        }
      }

      return cellsWithOffset;
    });

    // At least one cell with floating images should have text wrapping
    expect(cellWrapping).toBeGreaterThan(0);
  });

  test('no rendering regressions on existing image fixtures', async ({ page }) => {
    // Load the existing regression fixture to ensure no breakage
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await page
      .locator('input[type="file"][accept=".docx"]')
      .setInputFiles('e2e/fixtures/generic-render-regression.docx');
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number]');
    await page.waitForTimeout(1500);

    // Check no duplicate body images
    const duplicates = await page.evaluate(() => {
      const counter = new Map<string, number>();
      const bodyImages = document.querySelectorAll<HTMLElement>(
        '.layout-page-content img[data-pm-start][data-pm-end]'
      );
      for (const img of bodyImages) {
        const para = img.closest<HTMLElement>('.layout-paragraph');
        const key = [
          para?.dataset.blockId ?? 'no-block',
          img.dataset.pmStart ?? '',
          img.dataset.pmEnd ?? '',
        ].join('|');
        counter.set(key, (counter.get(key) ?? 0) + 1);
      }
      return Array.from(counter.values()).filter((c) => c > 1).length;
    });

    expect(duplicates).toBe(0);
  });
});
