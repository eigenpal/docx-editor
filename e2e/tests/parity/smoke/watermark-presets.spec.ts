import { expect, forEachAdapter } from '../parity-fixture';

// The watermark dialog's preset list is driven by the `watermarkPresets` prop
// in both adapters. Both demos pass a hardcoded custom list, so those phrases
// must replace the built-in MS Word defaults in either editor.
forEachAdapter(
  'smoke: watermarkPresets prop fills the preset dropdown',
  async (adapter, { page }) => {
    await page.goto(`${adapter.baseUrl}/?e2e=1`);
    await page.waitForSelector(adapter.readySelector, { timeout: 25000 });
    await expect(page.locator('.paged-editor__pages')).toBeVisible();

    // Insert menu → Watermark opens the dialog (same path in both adapters). The
    // demo auto-loads a fixture on mount; the React menu bar enables once it does.
    const insert = page.getByRole('button', { name: /^Insert$/ });
    await expect(insert).toBeEnabled({ timeout: 25000 });
    await insert.click();
    await page.getByRole('button', { name: /^Watermark$/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Reveal the text sub-form so the preset dropdown renders.
    await dialog.locator('#wm-text').check();

    // The preset <select> is the first select in the text sub-form. Its options
    // are the empty placeholder plus exactly the custom presets — the built-in
    // CONFIDENTIAL/DRAFT/… defaults must be gone.
    const presetSelect = dialog.locator('select').first();
    const options = await presetSelect.locator('option').allInnerTexts();
    expect(options).toEqual(['—', 'SAMPLE', 'DEMO ONLY', 'PREVIEW', 'NOT FOR DISTRIBUTION']);
  }
);
