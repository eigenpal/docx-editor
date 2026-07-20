/**
 * Interactive content-control widgets (#622 phase 3): clicking the painter
 * triggers toggles a checkbox, picks a dropdown item, and sets a date — through
 * the real React editor. Drives actual pointer interaction on the painted
 * `.layout-sdt-widget` triggers, then asserts the value via the editor ref hook.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import type { Page } from '@playwright/test';

function controlText(page: Page, tag: string): Promise<string | undefined> {
  return page.evaluate(
    (t) => window.__DOCX_EDITOR_E2E__?.agentGetContentControls({ tag: t })[0]?.text,
    tag
  );
}

test.describe('Content-control widgets (#622)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile('fixtures/block-sdt-widgets.docx');
  });

  test('clicking the checkbox trigger toggles its value', async ({ page }) => {
    expect(await controlText(page, 'agree')).toBe('☐');
    await page.locator('.layout-sdt-widget[data-sdt-tag="agree"]').click();
    await expect.poll(() => controlText(page, 'agree')).toBe('☒');
    // toggles back
    await page.locator('.layout-sdt-widget[data-sdt-tag="agree"]').click();
    await expect.poll(() => controlText(page, 'agree')).toBe('☐');
  });

  test('clicking the dropdown trigger opens a menu and selects an item', async ({ page }) => {
    expect(await controlText(page, 'status')).toBe('Draft');
    await page.locator('.layout-sdt-widget[data-sdt-tag="status"]').click();
    const menu = page.locator('.layout-sdt-widget-popup');
    await expect(menu).toBeVisible();
    await menu.getByRole('option', { name: 'Final' }).click();
    await expect.poll(() => controlText(page, 'status')).toBe('Final');
  });

  test('the date trigger opens a picker and sets the formatted date', async ({ page }) => {
    await page.locator('.layout-sdt-widget[data-sdt-tag="effective"]').click();
    const input = page.locator('.layout-sdt-widget-date');
    await expect(input).toBeVisible();
    await input.fill('2026-06-01');
    // change event fires on fill for date inputs
    await expect.poll(() => controlText(page, 'effective')).toBe('June 1, 2026');
  });

  // ── edge cases ────────────────────────────────────────────────────────────

  test('locked and data-bound controls render no editable trigger', async ({ page }) => {
    await expect(page.locator('.layout-sdt-widget[data-sdt-tag="agree"]')).toHaveCount(1);
    await expect(page.locator('.layout-sdt-widget[data-sdt-tag="lockedchoice"]')).toHaveCount(0);
    await expect(page.locator('.layout-sdt-widget[data-sdt-tag="boundcheck"]')).toHaveCount(0);
  });

  test('checkbox toggles back to unchecked on a second click', async ({ page }) => {
    const cb = page.locator('.layout-sdt-widget[data-sdt-tag="agree"]');
    await cb.click();
    await expect.poll(() => controlText(page, 'agree')).toBe('☒');
    await cb.click();
    await expect.poll(() => controlText(page, 'agree')).toBe('☐');
  });

  test('dropdown is keyboard operable (Enter opens, arrows + Enter select)', async ({ page }) => {
    // Open via the trigger's keyboard handler (focus + Enter atomically, so the
    // editor can't steal focus between the two in the test harness).
    await page.locator('.layout-sdt-widget[data-sdt-tag="status"]').evaluate((el) => {
      (el as HTMLElement).focus();
      el.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    await expect(page.locator('.layout-sdt-widget-popup')).toBeVisible();
    // Focus is now on the selected option (Draft). Real keys: ArrowDown → Final, Enter selects.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect.poll(() => controlText(page, 'status')).toBe('Final');
  });

  test('Escape closes the dropdown without changing the value', async ({ page }) => {
    await page.locator('.layout-sdt-widget[data-sdt-tag="status"]').click();
    await expect(page.locator('.layout-sdt-widget-popup')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.layout-sdt-widget-popup')).toHaveCount(0);
    expect(await controlText(page, 'status')).toBe('Draft');
  });

  test('clicking outside closes the dropdown', async ({ page }) => {
    await page.locator('.layout-sdt-widget[data-sdt-tag="status"]').click();
    await expect(page.locator('.layout-sdt-widget-popup')).toBeVisible();
    await page.mouse.click(5, 5); // far from the popup
    await expect(page.locator('.layout-sdt-widget-popup')).toHaveCount(0);
  });

  test('undo restores the value after a widget edit', async ({ page }) => {
    await page.locator('.layout-sdt-widget[data-sdt-tag="status"]').click();
    await page
      .locator('.layout-sdt-widget-popup')
      .getByRole('option', { name: 'Archived' })
      .click();
    await expect.poll(() => controlText(page, 'status')).toBe('Archived');
    await editor.undo();
    await expect.poll(() => controlText(page, 'status')).toBe('Draft');
  });
});

test.describe('Inline checkbox content-control widgets', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile('fixtures/inline-checkbox-controls.docx');
  });

  test('clicking an inline checkbox glyph toggles the Word control value', async ({ page }) => {
    const checkbox = page.locator('.layout-inline-sdt-widget[data-sdt-tag="option-alpha"]');
    await expect(checkbox).toHaveText('☐');
    expect(await controlText(page, 'option-alpha')).toBe('☐');

    await checkbox.click();
    await expect.poll(() => controlText(page, 'option-alpha')).toBe('☒');
    await expect(checkbox).toHaveText('☒');

    await checkbox.click();
    await expect.poll(() => controlText(page, 'option-alpha')).toBe('☐');
    await expect(checkbox).toHaveText('☐');
  });

  test('untagged inline checkboxes toggle by document position', async ({ page }) => {
    const untagged = page.locator('.layout-inline-sdt-widget:not([data-sdt-tag])');
    await expect(untagged).toHaveCount(1);
    await expect(untagged).toHaveText('☐');

    await untagged.click();
    await expect(untagged).toHaveText('☒');
  });

  test('locked, bound, and plain-text fallback boxes are not editable widgets', async ({
    page,
  }) => {
    await expect(page.locator('.layout-inline-sdt-widget')).toHaveCount(3);
    await expect(
      page.locator('.layout-inline-sdt-widget[data-sdt-tag="locked-checkbox"]')
    ).toHaveCount(0);
    await expect(
      page.locator('.layout-inline-sdt-widget[data-sdt-tag="bound-checkbox"]')
    ).toHaveCount(0);
    await expect(
      page.locator('.layout-page-content').getByText('[ X ] Plain text fallback')
    ).toBeVisible();
  });

  test('undo restores an inline checkbox edit', async ({ page }) => {
    const checkbox = page.locator('.layout-inline-sdt-widget[data-sdt-tag="option-alpha"]');
    await checkbox.click();
    await expect.poll(() => controlText(page, 'option-alpha')).toBe('☒');
    await editor.undo();
    await expect.poll(() => controlText(page, 'option-alpha')).toBe('☐');
  });
});
