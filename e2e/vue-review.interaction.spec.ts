// Vue review rail and chrome — user-report flows on the composed demo.

import { expect, test, type Page } from '@playwright/test';

const VUE_URL = 'http://localhost:5274/';
const CLEAN_URL = `${VUE_URL}?fixture=review-clean-demo.docx`;
const COMMENTED_URL = `${VUE_URL}?fixture=review-nav-demo.docx`;
const SCROLLER = '.docx-editor__scroll-container';

async function waitForEditor(page: Page, url = VUE_URL): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('composed-mount')).toBeVisible();
  await page.waitForSelector('.docx-page', { timeout: 30_000 });
}

async function openContextMenu(page: Page): Promise<{ x: number; y: number }> {
  const fragment = page.locator('.docx-paragraph-fragment').first();
  await expect(fragment).toBeVisible({ timeout: 15_000 });
  const box = await fragment.boundingBox();
  if (!box) throw new Error('paragraph fragment missing');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y, { button: 'right' });
  await expect(page.locator('.docx-contextmenu')).toBeVisible();
  return { x, y };
}

async function ensureReviewPaneOpen(page: Page): Promise<void> {
  const rail = page.locator('[data-testid="review-rail"]');
  await expect(rail).toBeVisible({ timeout: 15_000 });
  if (await rail.evaluate((node) => node.hasAttribute('data-open'))) return;
  const toggle = page.locator('.docx-toolbar [data-slot="review.comments"]').first();
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toHaveAttribute('data-disabled', '');
  await toggle.click();
  await expect(rail).toHaveAttribute('data-open', '');
}

test.describe('Vue review chrome', () => {
  test('right-click lists review.comments before other packaged rows end', async ({ page }) => {
    await waitForEditor(page, CLEAN_URL);
    const click = await openContextMenu(page);
    const menu = await page.locator('.docx-contextmenu').boundingBox();
    expect(menu).not.toBeNull();
    expect(Math.abs((menu?.x ?? 0) - click.x)).toBeLessThan(2);
    expect(Math.abs((menu?.y ?? 0) - click.y)).toBeLessThan(2);
    const slots = await page
      .locator('.docx-contextmenu [data-slot]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-slot')));
    expect(slots.at(-1)).toBe('review.comments');
    await expect(page.getByRole('menuitem', { name: /Add a comment/i })).toBeVisible();
  });

  test('rulers match the page and Page Setup stays a dialog', async ({ page }) => {
    await waitForEditor(page, CLEAN_URL);
    const pageBox = await page.locator('.docx-page').first().boundingBox();
    const horizontal = await page.locator('.docx-horizontal-ruler').boundingBox();
    const vertical = await page.locator('.docx-vertical-ruler').boundingBox();
    expect(pageBox).not.toBeNull();
    expect(horizontal?.width).toBeCloseTo(pageBox?.width ?? 0, 0);
    expect(horizontal?.height).toBeCloseTo(28, 0);
    expect(vertical?.width).toBeCloseTo(20, 0);

    await page.getByRole('menuitem', { name: 'File' }).click();
    await page.getByRole('menuitem', { name: /Page setup/i }).click();
    const dialog = page.getByRole('dialog', { name: 'Page Setup' });
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox?.width).toBeLessThanOrEqual(480);
    expect(dialogBox?.width).toBeGreaterThanOrEqual(400);
  });

  test('toolbar review button opens the review rail', async ({ page }) => {
    await waitForEditor(page, CLEAN_URL);
    await ensureReviewPaneOpen(page);
  });

  test('header chrome shows Header and Options opens the menu', async ({ page }) => {
    await page.goto(`${VUE_URL}?fixture=review-header-demo.docx`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await page.waitForSelector('.docx-page', { timeout: 30_000 });
    const headerBand = page.locator('[data-docx-hf="header"]').first();
    await headerBand.dblclick();
    const chrome = page.locator('[data-testid="docx-hf-chrome"]');
    await expect(chrome).toBeVisible({ timeout: 15_000 });
    await expect(chrome).toContainText('Header');
    const [headerBox, chromeBox] = await Promise.all([
      headerBand.boundingBox(),
      chrome.boundingBox(),
    ]);
    expect(chromeBox?.x).toBeCloseTo(headerBox?.x ?? 0, 0);
    expect(chromeBox?.width).toBeCloseTo(headerBox?.width ?? 0, 0);
    await page.getByRole('button', { name: 'Options' }).click();
    await expect(page.getByRole('menuitem', { name: 'Insert current page number' })).toBeVisible();
  });

  test('commented fixture renders existing review cards', async ({ page }) => {
    await page.goto(COMMENTED_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await page.waitForSelector('.docx-page', { timeout: 30_000 });
    await expect(page.locator('[data-testid="review-card"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('[data-testid="review-rail"]')).toContainText('Check this.');
  });

  test('Add a comment opens a draft and submits through the rail', async ({ page }) => {
    await waitForEditor(page, CLEAN_URL);
    await ensureReviewPaneOpen(page);
    const scroller = page.locator(SCROLLER);
    await scroller.click();
    await page.keyboard.press('Control+A');
    await page.locator('[data-testid="review-add-comment"]').click();
    await expect(page.locator('[data-testid="review-draft"]')).toBeVisible();
    const input = page.locator('[data-testid="review-draft-input"]');
    await input.fill('Browser draft note');
    await page.locator('[data-testid="review-draft-submit"]').click();
    await expect(page.locator('[data-testid="review-draft"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="review-card"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="review-card"]').first()).toContainText(
      'Browser draft note'
    );
  });
});
