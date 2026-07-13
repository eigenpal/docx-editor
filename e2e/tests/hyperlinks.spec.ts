/**
 * Hyperlink Tests
 *
 * Tests for hyperlink functionality:
 * - Insert hyperlink via Cmd+K
 * - Insert hyperlink via toolbar button
 * - Edit existing hyperlink
 * - Remove hyperlink
 * - Hyperlink dialog validation
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const getModifier = () => (process.platform === 'darwin' ? 'Meta' : 'Control');

/** Links render in the body PM toDOM and/or the painted page. */
function linkLocator(page: import('@playwright/test').Page, href: string) {
  return page
    .locator(`.paged-editor__hidden-pm a[href="${href}"], .layout-page-content a[href="${href}"]`)
    .first();
}

async function typeAndSelect(
  editor: EditorPage,
  page: import('@playwright/test').Page,
  text: string
) {
  await editor.focus();
  await editor.typeText(text);
  await editor.selectAll();
  await page.waitForTimeout(50);
}

test.describe('Hyperlinks', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.gotoEmpty();
    await editor.waitForReady();
    await editor.focus();
  });

  test('should open hyperlink dialog with Cmd+K', async ({ page }) => {
    await typeAndSelect(editor, page, 'Click here');

    await page.keyboard.down(getModifier());
    await page.keyboard.press('k');
    await page.keyboard.up(getModifier());

    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#hyperlink-dialog-title')).toHaveText('Insert Hyperlink');
  });

  test('should open hyperlink dialog via toolbar button', async ({ page }) => {
    await typeAndSelect(editor, page, 'Click here');

    await page.locator('[data-testid="toolbar-insert-link"]').click();

    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });
  });

  test('should insert hyperlink with URL', async ({ page }) => {
    await typeAndSelect(editor, page, 'Visit Google');

    await page.locator('[data-testid="toolbar-insert-link"]').click();
    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await page.locator('#hyperlink-url').fill('https://google.com');
    await page.locator('.docx-hyperlink-dialog-submit').click();

    await expect(dialog).not.toBeVisible();
    const link = linkLocator(page, 'https://google.com');
    await expect(link).toBeVisible({ timeout: 5000 });
    await expect(link).toHaveText('Visit Google');
  });

  test('should require URL to submit', async ({ page }) => {
    await typeAndSelect(editor, page, 'Click here');

    await page.locator('[data-testid="toolbar-insert-link"]').click();
    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await expect(page.locator('#hyperlink-url')).toHaveValue('');
    await expect(page.locator('.docx-hyperlink-dialog-submit')).toBeDisabled();
  });

  test('should close dialog on Cancel', async ({ page }) => {
    await typeAndSelect(editor, page, 'Click here');

    await page.locator('[data-testid="toolbar-insert-link"]').click();
    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await page.locator('.docx-hyperlink-dialog-cancel').click();
    await expect(dialog).not.toBeVisible();
  });

  test('should close dialog on Escape', async ({ page }) => {
    await typeAndSelect(editor, page, 'Click here');

    await page.locator('[data-testid="toolbar-insert-link"]').click();
    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await page.locator('#hyperlink-url').focus();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  test('should auto-add https:// if protocol missing', async ({ page }) => {
    await typeAndSelect(editor, page, 'Google');

    await page.locator('[data-testid="toolbar-insert-link"]').click();
    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await page.locator('#hyperlink-url').fill('google.com');
    await page.locator('.docx-hyperlink-dialog-submit').click();

    await expect(linkLocator(page, 'https://google.com')).toBeVisible({ timeout: 5000 });
  });

  test('should support mailto: links', async ({ page }) => {
    await typeAndSelect(editor, page, 'Email us');

    await page.locator('[data-testid="toolbar-insert-link"]').click();
    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await page.locator('#hyperlink-url').fill('mailto:test@example.com');
    await page.locator('.docx-hyperlink-dialog-submit').click();

    await expect(linkLocator(page, 'mailto:test@example.com')).toBeVisible({ timeout: 5000 });
  });

  test('should open links in new tab', async ({ page }) => {
    await typeAndSelect(editor, page, 'External');

    await page.locator('[data-testid="toolbar-insert-link"]').click();
    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await page.locator('#hyperlink-url').fill('https://example.com');
    await page.locator('.docx-hyperlink-dialog-submit').click();

    const link = linkLocator(page, 'https://example.com');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('should insert hyperlink with tooltip', async ({ page }) => {
    await typeAndSelect(editor, page, 'Hover me');

    await page.locator('[data-testid="toolbar-insert-link"]').click();
    const dialog = page.locator('.docx-hyperlink-dialog');
    await expect(dialog).toBeVisible({ timeout: 10000 });

    await page.locator('#hyperlink-url').fill('https://example.com');
    await page.locator('#hyperlink-tooltip').fill('This is a tooltip');
    await page.locator('.docx-hyperlink-dialog-submit').click();

    await expect(linkLocator(page, 'https://example.com')).toHaveAttribute(
      'title',
      'This is a tooltip'
    );
  });
});
