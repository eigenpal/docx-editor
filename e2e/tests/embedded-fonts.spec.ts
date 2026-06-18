/**
 * Embedded font rendering (happy path).
 *
 * Loads a DOCX that embeds an obfuscated font under a distinctive family name
 * ("Embedded Demo Sans") that is NOT installed on any system. The font can only
 * appear — rendered or in the picker — if the editor de-obfuscated the
 * `.odttf` and registered it as an `@font-face`. See
 * `e2e/fixtures/build-embedded-font-fixture.mjs`.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const EMBEDDED_FAMILY = 'Embedded Demo Sans';

test.describe('Embedded fonts', () => {
  test('de-obfuscates the embedded face and registers it as @font-face', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile('fixtures/embedded-font.docx');

    await page.waitForFunction(
      (family) =>
        Array.from(document.fonts).some(
          (f) => f.family.replace(/^["']|["']$/g, '') === family && f.status === 'loaded'
        ),
      EMBEDDED_FAMILY,
      { timeout: 10000 }
    );

    const loaded = await page.evaluate(
      (family) =>
        Array.from(document.fonts).some(
          (f) => f.family.replace(/^["']|["']$/g, '') === family && f.status === 'loaded'
        ),
      EMBEDDED_FAMILY
    );
    expect(loaded).toBe(true);
  });

  test('lists the embedded font in the picker under "Document fonts"', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
    await editor.loadDocxFile('fixtures/embedded-font.docx');
    // Wait for OUR fixture's face specifically — the default demo doc loads
    // first on goto, so a generic "fonts loaded" check would race it.
    await page.waitForFunction(
      (family) =>
        Array.from(document.fonts).some(
          (f) => f.family.replace(/^["']|["']$/g, '') === family && f.status === 'loaded'
        ),
      EMBEDDED_FAMILY,
      { timeout: 10000 }
    );

    await page.locator('[aria-label="Select font family"]').click();

    await expect(page.getByText('Document fonts', { exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: EMBEDDED_FAMILY, exact: true })).toBeVisible();
  });
});
