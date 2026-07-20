import { test, expect } from '@playwright/test';

/**
 * Regression for #887 — after #881 moved the ruler row inside the scroll
 * viewport, the outline toggle button and the open outline panel (both
 * absolutely positioned in `__editor-area`) must clear the sticky ruler row
 * instead of overlapping it.
 */
test('Vue outline toggle and panel clear the sticky ruler row', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.waitForSelector('.docx-editor-vue__pages .layout-page', { timeout: 15000 });

  const ruler = page.locator('.docx-editor-vue__ruler-row');
  await expect(ruler).toBeVisible();
  const rulerBox = await ruler.boundingBox();
  expect(rulerBox).not.toBeNull();
  const rulerBottom = rulerBox!.y + rulerBox!.height;

  // The collapsed toggle must sit fully below the ruler's bottom edge.
  const toggle = page.locator('.docx-editor-vue__outline-toggle');
  await expect(toggle).toBeVisible();
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox).not.toBeNull();
  expect(toggleBox!.y).toBeGreaterThanOrEqual(rulerBottom - 1);

  // Opening the outline: its panel must also start below the ruler.
  await toggle.click();
  const panel = page.locator('.doc-outline');
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.y).toBeGreaterThanOrEqual(rulerBottom - 1);
});

/**
 * Companion coverage for #881 — on a viewport narrower than the page, the
 * scroll viewport must expose horizontal scroll (instead of clipping the page
 * or shifting it left) so the whole page is reachable.
 */
test('Vue narrow viewport exposes horizontal scroll to the full page', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto('http://localhost:5174/?e2e=1');
  await page.waitForSelector('.docx-editor-vue__pages .layout-page', { timeout: 15000 });

  const metrics = await page
    .locator('.docx-editor-vue__pages-viewport')
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));

  // Content is wider than the viewport, so horizontal scrolling is available.
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
});
