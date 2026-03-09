/**
 * Hyperlink Popup Tests
 *
 * Tests for the Google Docs-style hyperlink popup that appears when clicking
 * on a hyperlink in the visible pages.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const DEMO_DOCX_PATH = 'fixtures/demo/demo.docx';

test.describe('Hyperlink Popup', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile(DEMO_DOCX_PATH);
  });

  test('shows popup when clicking an external hyperlink on visible pages', async ({ page }) => {
    // Find a hyperlink on the visible pages (layout-painted DOM)
    const pagesContainer = page.locator('.paged-editor__pages');
    const link = pagesContainer.locator('a[href]').first();
    await expect(link).toBeVisible({ timeout: 10000 });

    // Click the link
    await link.click();

    // The hyperlink popup should appear
    const popup = page.locator('.ep-hyperlink-popup');
    await expect(popup).toBeVisible({ timeout: 5000 });
  });

  test('popup shows the URL of the clicked link', async ({ page }) => {
    const pagesContainer = page.locator('.paged-editor__pages');
    const link = pagesContainer.locator('a[href]').first();
    await expect(link).toBeVisible({ timeout: 10000 });

    const href = await link.getAttribute('href');

    // Click the link
    await link.click();

    // The popup should show the URL
    const popup = page.locator('.ep-hyperlink-popup');
    await expect(popup).toBeVisible({ timeout: 5000 });
    await expect(popup).toContainText(href!.substring(0, 20)); // At least partial URL
  });

  test('popup closes when clicking elsewhere', async ({ page }) => {
    const pagesContainer = page.locator('.paged-editor__pages');
    const link = pagesContainer.locator('a[href]').first();
    await expect(link).toBeVisible({ timeout: 10000 });

    // Click the link to show popup
    await link.click();
    const popup = page.locator('.ep-hyperlink-popup');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // Click elsewhere on the page (not on the popup or link)
    await page.locator('.paged-editor').click({ position: { x: 100, y: 500 } });

    // Popup should close
    await expect(popup).not.toBeVisible({ timeout: 3000 });
  });

  test('popup closes on Escape key', async ({ page }) => {
    const pagesContainer = page.locator('.paged-editor__pages');
    const link = pagesContainer.locator('a[href]').first();
    await expect(link).toBeVisible({ timeout: 10000 });

    // Click the link to show popup
    await link.click();
    const popup = page.locator('.ep-hyperlink-popup');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // Press Escape
    await page.keyboard.press('Escape');

    // Popup should close
    await expect(popup).not.toBeVisible({ timeout: 3000 });
  });

  test('clicking link in popup does not navigate the page', async ({ page }) => {
    const pagesContainer = page.locator('.paged-editor__pages');
    const link = pagesContainer.locator('a[href]').first();
    await expect(link).toBeVisible({ timeout: 10000 });

    // Click the link
    await link.click();

    // The popup should appear (not navigate away)
    const popup = page.locator('.ep-hyperlink-popup');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // We should still be on the same page
    expect(page.url()).toContain('localhost');
  });

  test('popup has edit and unlink buttons in edit mode', async ({ page }) => {
    // Switch to editing mode
    const viewingToggle = page.locator('text=Editing').first();
    if (await viewingToggle.isVisible()) {
      // Already in editing mode
    } else {
      const toggle = page.locator('[class*="toggle"], [role="switch"]').first();
      if (await toggle.isVisible()) {
        await toggle.click();
        await page.waitForTimeout(300);
      }
    }

    const pagesContainer = page.locator('.paged-editor__pages');
    const link = pagesContainer.locator('a[href]').first();
    await expect(link).toBeVisible({ timeout: 10000 });

    // Click the link
    await link.click();

    // The popup should have edit and unlink buttons
    const popup = page.locator('.ep-hyperlink-popup');
    await expect(popup).toBeVisible({ timeout: 5000 });

    // Check for icon buttons (edit and unlink)
    const buttons = popup.locator('button');
    const buttonCount = await buttons.count();
    // Should have at least copy + edit + unlink = 3 buttons
    expect(buttonCount).toBeGreaterThanOrEqual(3);
  });
});
