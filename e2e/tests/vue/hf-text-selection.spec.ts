import { test, expect } from '@playwright/test';

// Regression for #691: text selection inside a header/footer during HF edit
// mode rendered nothing in Vue. The body selection overlay is gated off in HF
// mode, but Vue never computed the HF selection rects (only the caret), so a
// drag/select-all in the header set the HF PM selection without any visible
// highlight. The painter draws `.vue-hf-sel-rect` divs from
// `readHfSelectionGeometry` now.
test('Vue: selecting header text paints HF selection rects', async ({ page }) => {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles('e2e/fixtures/header-with-table.docx');

  await page.waitForSelector('[data-page-number]');
  await expect(page.locator('.layout-page-header [data-from-row]')).toHaveCount(1, {
    timeout: 15000,
  });

  // Engage HF edit mode and place the caret on a painted header span.
  const header = page.locator('.layout-page-header').first();
  await header.dblclick();
  await expect(page.locator('.hf-editor')).toHaveCount(1);

  const span = page.locator('.layout-page-header span[data-doc-from]').first();
  await span.click();

  // No selection rects while the caret is collapsed.
  await expect(page.locator('.vue-hf-sel-rect')).toHaveCount(0);

  // Select all header text — sets a non-empty range on the HF PM document.
  await page.keyboard.press('ControlOrMeta+a');

  // The highlight must appear over the painted header.
  await expect(page.locator('.vue-hf-sel-rect').first()).toBeVisible({ timeout: 5000 });

  // Collapsing the selection clears the rects again.
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.vue-hf-sel-rect')).toHaveCount(0);
});

// Regression for #691 (footer, multi-page): the same header/footer is painted
// on every page, but the caret/selection overlay was always resolved against
// the FIRST painted instance (page 1). Editing a footer on a later page drew
// the highlight on page 1 — off-screen — so the user saw nothing. The overlay
// now resolves against the painted instance nearest the viewport.
test('Vue: footer selection on a later page paints rects on that page', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  // Default demo document: multi-page with a footer ("Page N of M ...").
  await page.goto('http://localhost:5174/');
  await page.locator('.docx-editor-vue').waitFor();
  await page.locator('.paged-editor__pages').waitFor();
  await page.waitForSelector('[data-page-number]');

  const footers = page.locator('.layout-page-footer');
  await expect(footers.nth(1)).toBeAttached({ timeout: 15000 });

  // Engage the SECOND page's footer and select all its text.
  const footer2 = footers.nth(1);
  await footer2.scrollIntoViewIfNeeded().catch(() => {});
  await footer2.dblclick();
  await expect(page.locator('.hf-editor')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+a');

  const rect = page.locator('.vue-hf-sel-rect').first();
  await expect(rect).toBeVisible({ timeout: 5000 });

  // The highlight must sit on the page-2 footer the user is editing, not page 1.
  const placement = await page.evaluate(() => {
    const fEl = document.querySelectorAll('.layout-page-footer')[1] as HTMLElement;
    const r = document.querySelector('.vue-hf-sel-rect') as HTMLElement;
    if (!fEl || !r) return null;
    const fb = fEl.getBoundingClientRect();
    const rb = r.getBoundingClientRect();
    return { onEditedFooter: rb.top >= fb.top - 8 && rb.bottom <= fb.bottom + 8 };
  });
  expect(placement?.onEditedFooter).toBe(true);
});
