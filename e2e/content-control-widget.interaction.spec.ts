import { resolve } from 'node:path';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { expect, test } from '@playwright/test';

declare global {
  interface Window {
    __ccwReviewZoom?: (zoom: number) => unknown;
  }
}

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
  await input.fill('Custom value');
  await expect(input).toHaveValue('Custom value');
  expect(await page.locator('.docx-page-content').allTextContents()).toEqual(before);
  await page.keyboard.press('Enter');
  await expect(page.locator('.docx-content-control-menu')).toHaveCount(0);
  await expect(page.locator('.docx-pages')).toContainText('Custom value');
});

test('the calendar shows all six weeks and Today, with one day in the Tab order', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.locator('[data-docx-cc-widget="date"]').click();
  const menu = page.locator('.docx-content-control-calendar');
  await page.screenshot({ path: test.info().outputPath('calendar-engine.png') });
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

test('calendar quick navigation, regional entry, errors, and focus wrapping', async ({ page }) => {
  await page.evaluate(() =>
    (window.__DOCX_EDITOR_E2E__!.getEditor() as DocxEditorInstance).setLocale('pl-PL')
  );
  await page.locator('[data-docx-cc-widget="date"]').click();
  const menu = page.locator('.docx-content-control-menu');
  await expect(menu.locator('[data-docx-part=title]')).toContainText('2026');
  await page.keyboard.press('Home');
  await expect(menu.locator('[data-iso="2026-09-14"]')).toBeFocused();
  await page.keyboard.press('Shift+PageDown');
  await expect(menu.locator('[data-iso="2027-09-14"]')).toBeFocused();
  await menu.locator('[data-docx-part=month]').selectOption('1');
  await expect(menu.locator('[data-docx-part=title]')).toContainText('luty');
  await menu.locator('[data-docx-part=year]').fill('2031');
  await menu.locator('[data-docx-part=year]').press('Enter');
  await expect(menu.locator('[data-docx-part=title]')).toContainText('2031');
  const input = menu.locator('[data-docx-part=input]');
  await input.fill('30.2.2026');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(menu.locator('[role=alert]')).toBeVisible();
  await input.fill('29.2.2028');
  await input.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('.docx-pages')).toBeFocused();
});

test('dropdown typeahead, Home/End, and combo suggestions keep writes explicit', async ({
  page,
}) => {
  await page.locator('[data-docx-cc-widget=dropdown]').click();
  const menu = page.locator('.docx-content-control-menu');
  await page.keyboard.press('c');
  await expect(menu.getByRole('option', { name: 'Charlie' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(menu.getByRole('option', { name: 'Alpha' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('option', { name: 'Charlie' })).toBeFocused();
  await page.keyboard.press('Escape');
  await page.locator('[data-docx-cc-widget=comboBox]').click();
  await expect(menu.locator('input')).toHaveAttribute('aria-autocomplete', 'list');
  await menu.locator('input').press('ArrowDown');
  await expect(menu.getByRole('option').first()).toBeFocused();
});

test('short viewport flips and scrolls the popup; Tab remains inside', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.locator('[data-docx-cc-widget=date]').click();
  const menu = page.locator('.docx-content-control-menu');
  const box = await menu.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(601);
  await expect(menu).toHaveAttribute('data-placement', 'top');
  await menu.locator('[data-docx-part=apply]').focus();
  await page.keyboard.press('Tab');
  await expect(menu.locator('[data-docx-part=previousMonth]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(menu.locator('[data-docx-part=apply]')).toBeFocused();
});

test('checkbox advance equals its box and the pointer target is at least 24px', async ({
  page,
}) => {
  const box = page.locator('[data-docx-form-checkbox]').first();
  const sizes = await box.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    glyph: parseFloat(getComputedStyle(element, '::before').width),
    target: element.querySelector('.docx-form-checkbox-hit')!.getBoundingClientRect().toJSON(),
  }));
  expect(sizes.width).toBeCloseTo(sizes.glyph, 1);
  expect(sizes.target.width).toBeGreaterThanOrEqual(24);
  expect(sizes.target.height).toBeGreaterThanOrEqual(24);
  await expect(box).toHaveAccessibleName('legacyCbOff');
  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).toHaveAttribute('aria-checked', 'true');
  await expect(box).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-docx-form-checkbox]').nth(1)).toBeFocused();
});

for (const adapter of ['react', 'vue'] as const) {
  test(`${adapter} host parts share calendar entry, keyboard, placement, and list behavior`, async ({
    page,
  }) => {
    if (adapter === 'vue') {
      await page.goto('http://localhost:5274/?fixture=form-controls-catalog.docx&e2e=1');
      await page.locator('.docx-pages').waitFor();
    }
    await page.evaluate(
      async ({ adapter, base }) => {
        const { mountWidget, mountCatalog } = await import(
          `${base}/e2e/content-control-widget-${adapter}-harness.ts`
        );
        const editor =
          adapter === 'vue'
            ? mountCatalog(
                new Uint8Array(await (await fetch('/form-controls-catalog.docx')).arrayBuffer())
              )
            : (window.__DOCX_EDITOR_E2E__!.getEditor() as DocxEditorInstance);
        window.__ccwReviewZoom = (zoom: number) => editor.setZoom(zoom);
        const scroller = document.querySelector('.docx-editor__scroll-container')!;
        editor.setContentControlWidgetChrome({
          onRequest: (session) => {
            const mount = document.createElement('div');
            scroller.append(mount);
            mountWidget(mount, session);
          },
        });
      },
      { adapter, base: `/@fs/${resolve(import.meta.dirname, '..')}` }
    );
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.locator('[data-docx-cc-widget=date]').click();
    const popup = page.locator('[data-docx-popup=contentControlWidget]');
    await expect(popup.locator('[data-iso="2026-09-17"]')).toBeFocused();
    await page.screenshot({ path: test.info().outputPath(`calendar-${adapter}.png`) });
    await page.evaluate(() => window.__ccwReviewZoom!(1.25));
    await expect(popup).toBeVisible();
    const placed = await popup.boundingBox();
    const boundary = await page
      .locator('[data-docx-cc-widget=date]')
      .evaluate((chip) =>
        chip
          .closest('[data-docx-content-control]')!
          .querySelector('.docx-content-control-boundary')!
          .getBoundingClientRect()
          .toJSON()
      );
    expect(placed!.x).toBeCloseTo(boundary.left, 0);
    await page.evaluate(() => window.__ccwReviewZoom!(1));

    await page.keyboard.press('PageDown');
    await expect(popup.locator('[data-iso="2026-10-17"]')).toBeFocused();
    await popup.locator('[data-docx-part=year]').fill('2031');
    await popup.locator('[data-docx-part=year]').press('Enter');
    await expect(popup.locator('[data-docx-part=title]')).toContainText('2031');
    const input = popup.locator('[data-docx-part=input]');
    await input.fill('2/30/2026');
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('2/29/2028');
    await input.press('Enter');
    await expect(popup).toHaveCount(0);
    await expect(page.locator('.docx-pages')).toBeFocused();
    await page.locator('[data-docx-cc-widget=dropdown]').click();
    await expect(popup.getByRole('option', { name: 'Alpha' })).toBeFocused();
    await page.keyboard.press('c');
    await expect(popup.getByRole('option', { name: 'Charlie' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(popup).toHaveCount(0);
  });
}

test('an open engine popup follows zoom without losing its draft', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.locator('[data-docx-cc-widget=date]').click();
  const menu = page.locator('.docx-content-control-menu');
  await menu.locator('[data-docx-part=input]').fill('12/25/2030');
  await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.setZoom(1.5));
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-docx-part=input]')).toHaveValue('12/25/2030');
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(1101);
});

test('the normal demo keeps the calendar actions visible on a laptop viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1200, height: 820 });
  await page.goto(`${origin}/?fixture=form-controls-catalog.docx`);
  await page.locator('[data-docx-cc-widget=date]').click();
  const popup = page.locator('.docx-content-control-calendar');
  const panel = await popup.boundingBox();
  const apply = await popup.locator('[data-docx-part=apply]').boundingBox();
  expect(apply!.y + apply!.height).toBeLessThanOrEqual(panel!.y + panel!.height);
  expect(
    await popup.evaluate((element) => element.scrollHeight - element.clientHeight)
  ).toBeLessThanOrEqual(2);
  await page.screenshot({ path: test.info().outputPath('calendar-normal-demo.png') });
});

test('gallery: the engine menu lists the glossary blocks and a pick fills the control', async ({
  page,
}) => {
  const paragraphs = page.locator('.docx-page-content .layout-paragraph');
  const count = await paragraphs.count();
  await page.locator('[data-docx-cc-widget="buildingBlockGallery"]').click();
  const menu = page.locator('.docx-content-control-menu');
  await expect(menu.locator('[role="option"]')).toHaveText(['Address block', 'Sign-off line']);
  await menu.locator('[role="option"]').nth(1).click();
  await expect(menu).toHaveCount(0);
  await expect(paragraphs).toHaveCount(count);
  await expect(page.locator('.docx-pages')).toContainText('Approved by:');
  await expect(page.locator('.docx-pages')).not.toContainText('Choose a building block.');
  expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.saveAndReopen())).toEqual({
    ok: true,
  });
  await expect(page.locator('.docx-pages')).toContainText('Approved by:');
});

test('picture: the widget opens a file picker and the chosen image replaces the picture', async ({
  page,
}) => {
  const image = page.locator('.docx-page-content img').first();
  const before = await image.getAttribute('src');
  // The engine's picker is a real file input, so the browser's chooser is the dialog.
  const chooserOpened = page.waitForEvent('filechooser');
  await page.locator('[data-docx-cc-widget="picture"]').click();
  const chooser = await chooserOpened;
  expect(chooser.isMultiple()).toBe(false);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64'
  );
  await chooser.setFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.docx-content-control-picture-picker')).toHaveCount(0);
  await expect
    .poll(async () => page.locator('.docx-page-content img').first().getAttribute('src'))
    .not.toBe(before);
  expect(await page.evaluate(() => window.__DOCX_EDITOR_E2E__!.saveAndReopen())).toEqual({
    ok: true,
  });
});
