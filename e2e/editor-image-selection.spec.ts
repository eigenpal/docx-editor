import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ORIGIN,
  jumpToHeading,
  revealLocator,
  waitForEditor,
} from './collaboration-review-helpers.ts';

function overlayFrame(page: Page): Locator {
  return page.locator('.docx-image-selection-overlay__frame');
}

async function largestVisible(locator: Locator): Promise<Locator> {
  const count = await locator.count();
  let bestIndex = 0;
  let bestArea = 0;
  for (let index = 0; index < count; index += 1) {
    const box = await locator.nth(index).boundingBox();
    if (!box) continue;
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      bestIndex = index;
    }
  }
  return locator.nth(bestIndex);
}

async function boxesClose(page: Page, drawing: Locator, tolerancePx = 12): Promise<void> {
  const overlay = overlayFrame(page);
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  const drawingBox = await drawing.boundingBox();
  const overlayBox = await overlay.boundingBox();
  if (!drawingBox || !overlayBox) throw new Error('missing bounding box');
  expect(Math.abs(overlayBox.x - drawingBox.x)).toBeLessThan(tolerancePx);
  expect(Math.abs(overlayBox.y - drawingBox.y)).toBeLessThan(tolerancePx);
  expect(Math.abs(overlayBox.width - drawingBox.width)).toBeLessThan(tolerancePx);
  expect(Math.abs(overlayBox.height - drawingBox.height)).toBeLessThan(tolerancePx);
}

test('image selection frame sits on an inline drawing and a wrap-square drawing', async ({
  page,
}) => {
  await waitForEditor(page, ORIGIN);

  await jumpToHeading(page, /10\.2 Block Image/);
  await revealLocator(page, page.getByText(/Figure 1: Test Banner/));
  const inlineBanner = await largestVisible(
    page.locator('.docx-page-content .docx-line .docx-drawing')
  );
  await expect(inlineBanner).toBeVisible({ timeout: 15_000 });
  await inlineBanner.click();
  await boxesClose(page, inlineBanner);

  await jumpToHeading(page, /10\.3 Floating Image/);
  await revealLocator(page, page.getByText(/This text wraps around a floating image/));
  const floating = await largestVisible(page.locator('.docx-drawing-layer .docx-drawing'));
  await expect(floating).toBeVisible({ timeout: 15_000 });
  await floating.click();
  await boxesClose(page, floating);
});
