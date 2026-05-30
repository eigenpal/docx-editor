/**
 * Tracked non-text elements — an image inserted in suggesting mode is a
 * genuine tracked change: it paints with a revision outline, shows one sidebar
 * card, Reject removes the picture, Accept keeps it as a plain image.
 *
 * Generalizes the tracked-changes model from text to inline atom nodes
 * (image, shape, …). Background: "all elements should be tracked".
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

// 1×1 transparent PNG.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function setSuggestionMode(page: import('@playwright/test').Page, active: boolean) {
  const ok = await page.evaluate(
    (a) => window.__DOCX_EDITOR_E2E__?.setSuggestionMode(a, 'Jane') ?? false,
    active
  );
  await page.locator('.ProseMirror').first().focus();
  return ok;
}

async function insertImage(page: import('@playwright/test').Page) {
  return page.evaluate((src) => window.__DOCX_EDITOR_E2E__?.insertImage?.(src) ?? false, PNG);
}

async function selectFirstImage(page: import('@playwright/test').Page) {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__?.selectFirstImage?.() ?? false);
}

test.describe('Tracked image insertion', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.gotoEmpty();
    await editor.waitForReady();
    await editor.focus();
  });

  test('image inserted in suggesting mode paints as a tracked insertion', async ({ page }) => {
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(150);

    // The painted picture carries the revision dataset + green outline.
    const tracked = page.locator('img.docx-insertion[data-revision-id]');
    await expect(tracked).toHaveCount(1);
    await expect(tracked).toHaveCSS('outline-color', 'rgb(46, 125, 50)');
  });

  test('an inserted image gets a sidebar card anchored at the image', async ({ page }) => {
    // The card must anchor to the picture's Y, not a fallback position — the
    // sidebar anchor map has to register the revision id from the image atom,
    // not only from text nodes. Without it, an image-only change shows no card.
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(150);

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }

    const card = page.locator('.docx-tracked-change-card');
    await expect(card).toHaveCount(1);

    const imgTop = await page
      .locator('img.docx-insertion')
      .first()
      .evaluate((el) => el.getBoundingClientRect().top);
    const cardTop = await card.first().evaluate((el) => el.getBoundingClientRect().top);
    // Anchored next to the image (not at the unpositioned fallback ~top of doc).
    expect(Math.abs(cardTop - imgTop)).toBeLessThan(80);
  });

  test('Reject removes the inserted image and its card', async ({ page }) => {
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(150);

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(1);

    await page.locator('.docx-tracked-change-card button[title="Reject"]').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('img.layout-run-image')).toHaveCount(0);
    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(0);
  });

  test('Accept keeps the inserted image as a plain picture', async ({ page }) => {
    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(150);

    const toggle = page.locator('[aria-label="Toggle comments sidebar"]');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('.docx-tracked-change-card')).toHaveCount(1);

    await page.locator('.docx-tracked-change-card button[title="Accept"]').first().click();
    await page.waitForTimeout(200);
    await expect(page.locator('img.layout-run-image')).toHaveCount(1);
    await expect(page.locator('img.docx-insertion')).toHaveCount(0);
    expect(await page.locator('[data-revision-id]').count()).toBe(0);
  });

  test('deleting an existing image in suggesting mode strikes it through (tracked)', async ({
    page,
  }) => {
    // Insert a permanent picture in editing mode, then delete it while suggesting.
    expect(await setSuggestionMode(page, false)).toBe(true);
    expect(await insertImage(page)).toBe(true);
    await page.waitForTimeout(100);

    expect(await setSuggestionMode(page, true)).toBe(true);
    expect(await selectFirstImage(page)).toBe(true);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(150);

    // The picture stays but is marked as a tracked deletion (red outline),
    // not removed outright.
    const del = page.locator('img.docx-deletion[data-revision-id]');
    await expect(del).toHaveCount(1);
    await expect(del).toHaveCSS('outline-color', 'rgb(198, 40, 40)');
  });
});
