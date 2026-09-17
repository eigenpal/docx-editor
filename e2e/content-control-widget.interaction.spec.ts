import { expect, test } from '@playwright/test';

const origin = process.env.CCW_REVIEW_ORIGIN ?? 'http://localhost:5273';

test.beforeEach(async ({ page }) => {
  await page.goto(`${origin}/?fixture=form-controls-catalog.docx&e2e=1`);
  await page.waitForFunction(() => window.__DOCX_EDITOR_E2E__?.fontMeasurer() === 'shaped');
});

for (const kind of ['dropdown', 'date', 'comboBox'] as const) {
  test(`${kind}: Enter commits the focused value without editing a document paragraph`, async ({
    page,
  }) => {
    const paragraphs = page.locator('.docx-page-content .layout-paragraph');
    const count = await paragraphs.count();
    await page.locator(`[data-docx-cc-widget="${kind}"]`).click();
    const menu = page.locator('.docx-content-control-menu');
    const option =
      kind === 'date'
        ? menu.locator('[data-iso="2026-09-20"]')
        : menu.locator('[role="option"]').nth(1);
    await option.focus();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    await expect(paragraphs).toHaveCount(count);
    await expect(page.locator('.docx-pages')).toContainText(
      kind === 'date' ? '9/20/2026' : kind === 'dropdown' ? 'Bravo' : 'Medium'
    );
  });
}

test('combo-box typing stays in its input until Enter commits', async ({ page }) => {
  const before = await page.locator('.docx-page-content').allTextContents();
  await page.locator('[data-docx-cc-widget="comboBox"]').click();
  const input = page.locator('.docx-content-control-menu-input');
  await input.focus();
  await page.keyboard.type('Custom value');
  await expect(input).toHaveValue('Custom value');
  expect(await page.locator('.docx-page-content').allTextContents()).toEqual(before);
  await page.keyboard.press('Enter');
  await expect(page.locator('.docx-content-control-menu')).toHaveCount(0);
  await expect(page.locator('.docx-pages')).toContainText('Custom value');
});

test('the calendar shows all six weeks and Today, with one day in the Tab order', async ({
  page,
}) => {
  await page.locator('[data-docx-cc-widget="date"]').click();
  const menu = page.locator('.docx-content-control-calendar');
  const box = await menu.boundingBox();
  const today = await menu.getByRole('button', { name: 'Today', exact: true }).boundingBox();
  expect(today!.y + today!.height).toBeLessThanOrEqual(box!.y + box!.height);
  await expect(menu.locator('[role="row"]')).toHaveCount(6);
  await expect(menu.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('button', { name: 'Today', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.docx-pages')).toBeFocused();
});

test('legacy checkbox supports click, Space, undo, and save/reopen', async ({ page }) => {
  await page.locator('[data-slot="text.bold"]').focus();
  const box = page.locator('[data-docx-form-checkbox]').first();
  await box.click();
  await expect(page.locator('.docx-pages')).toBeFocused();
  await expect(box).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Space');
  await expect(box).toHaveAttribute('aria-checked', 'false');
  await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.undoBenchmarkEdit());
  await expect(box).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.saveAndReopen())).toEqual({
    ok: true,
  });
  await expect(box).toHaveAttribute('aria-checked', 'true');
});
