/**
 * Issue #777 (render-level) — a VML header logo must actually paint, and an
 * anchored image with `wp:positionH align="left"` must render left-aligned, not
 * centered. Loads a synthetic fixture with both. Core fix → React + Vue (a Vue
 * twin lives under e2e/tests/vue/).
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test('VML header logo renders and a left-anchored image is left-aligned (#777)', async ({
  page,
}) => {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForReady();
  await editor.loadDocxFile('fixtures/issue-777-vml-header.docx');
  await page.waitForSelector('[data-page-number]');

  // 1) The VML header logo paints as an image inside the painted header.
  const headerImg = page.locator('.layout-page-header img').first();
  await expect(headerImg).toHaveCount(1);
  const headerSrc = await headerImg.getAttribute('src');
  expect(headerSrc && headerSrc.length).toBeGreaterThan(0);

  // Aspect ratio is preserved: the shape style is 120pt × 40pt → 3:1, and the
  // painted image must keep that ratio (not stretch to a square / box).
  const box = await headerImg.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width / box!.height).toBeGreaterThan(2.7);
  expect(box!.width / box!.height).toBeLessThan(3.3);

  // 2) The left-anchored (topAndBottom, wp:align=left) body image renders on
  //    its own flex line, left-aligned (justify-content: flex-start), NOT
  //    centered.
  const align = await page.evaluate(() => {
    const blocks = Array.from(
      document.querySelectorAll('.layout-page-content .layout-line[data-flex-line="true"]')
    ) as HTMLElement[];
    const imageLine = blocks.find((l) => l.querySelector('img'));
    if (!imageLine) return null;
    return getComputedStyle(imageLine).justifyContent;
  });
  expect(align, 'left-anchored image line found').not.toBeNull();
  expect(align).toBe('flex-start');
});
