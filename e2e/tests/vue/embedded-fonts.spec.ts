/**
 * Vue: embedded font rendering (happy path). Mirror of the React spec in
 * e2e/tests/embedded-fonts.spec.ts. Loads a DOCX embedding "Embedded Demo Sans"
 * (a name not installed anywhere) and asserts the de-obfuscated face registers
 * and appears in the picker's "Document fonts" group.
 */

import { test, expect } from '@playwright/test';

const EMBEDDED_FAMILY = 'Embedded Demo Sans';

async function loadFixture(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('http://localhost:5174/?e2e=1');
  await page.waitForSelector('.docx-editor-vue', { timeout: 10000 });
  await page
    .locator('input[type="file"][accept=".docx"]')
    .setInputFiles('e2e/fixtures/embedded-font.docx');
}

test.describe('Vue: embedded fonts', () => {
  test('de-obfuscates the embedded face and registers it as @font-face', async ({ page }) => {
    await loadFixture(page);

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
    await loadFixture(page);
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

    await page.locator('.font-trigger').click();

    await expect(
      page.locator('.toolbar-dropdown__group-label', { hasText: 'Document fonts' })
    ).toBeVisible();
    await expect(
      page.locator('.toolbar-dropdown__item', { hasText: EMBEDDED_FAMILY })
    ).toBeVisible();
  });
});
