/**
 * highlightRange ref method (paginated editor).
 *
 * Regression guard: highlightRange takes raw caller positions, so an out-of-
 * range `to` used to make setSelection -> doc.resolve() throw a RangeError
 * instead of no-op'ing as the docstring promises. These specs drive positions
 * past the document end and assert the call resolves (no throw) and leaves the
 * selection within document bounds.
 *
 * Relies on `window.__DOCX_EDITOR_E2E__` from the Vite demo (examples/vite).
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

test.describe('highlightRange (E2E)', () => {
  test.beforeEach(async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
  });

  test('a `to` past the document end is clamped, not a crash', async ({ page }) => {
    const docSize = await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.getDocSize() ?? null);
    expect(docSize).not.toBeNull();

    // `to` well past the end — previously threw a RangeError in doc.resolve().
    const anchor = await page.evaluate((size) => {
      window.__DOCX_EDITOR_E2E__?.highlightRange(1, size + 1000);
      return window.__DOCX_EDITOR_E2E__?.getSelectionAnchor() ?? null;
    }, docSize as number);

    // No throw (evaluate resolved) and the selection landed inside the doc.
    expect(anchor).not.toBeNull();
    expect(anchor as number).toBeGreaterThanOrEqual(0);
    expect(anchor as number).toBeLessThanOrEqual(docSize as number);
  });

  test('a `from` past the document end is a no-op', async ({ page }) => {
    const docSize = await page.evaluate(() => window.__DOCX_EDITOR_E2E__?.getDocSize() ?? null);
    expect(docSize).not.toBeNull();

    const before = await page.evaluate(
      () => window.__DOCX_EDITOR_E2E__?.getSelectionAnchor() ?? null
    );

    const after = await page.evaluate((size) => {
      window.__DOCX_EDITOR_E2E__?.highlightRange(size + 50, size + 100);
      return window.__DOCX_EDITOR_E2E__?.getSelectionAnchor() ?? null;
    }, docSize as number);

    // No throw, and the selection is unchanged (clean no-op).
    expect(after).toBe(before);
  });
});
