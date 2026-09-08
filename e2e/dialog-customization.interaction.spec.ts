import { expect, test } from '@playwright/test';
for (const [adapter, port] of [
  ['React', 5273],
  ['Vue', 5274],
] as const) {
  test(`${adapter}: custom dialogs inherit their own theme and restore menu focus`, async ({
    page,
  }) => {
    await page.goto(`http://localhost:${port}/?dialogs=1`);
    const editors = page.locator('.dialog-demo-editors > .docx-editor');
    await expect(editors).toHaveCount(2);
    for (const [index, color] of [
      [0, 'rgb(89, 69, 184)'],
      [1, 'rgb(22, 115, 66)'],
    ] as const) {
      const editor = editors.nth(index);
      const file = editor.locator('[data-menu="file"] > [role="menuitem"]');
      await file.click();
      await editor.getByRole('menuitem', { name: /Page setup/i }).click();
      const dialog = page.locator('dialog[data-docx-dialog="pageSetup"]');
      await expect(dialog).toHaveCount(1);
      await expect(dialog).toBeVisible();
      const save = dialog.getByRole('button', { name: 'Save settings' });
      await expect(save).toHaveCSS('background-color', color);
      await expect(save).toHaveCSS('padding-left', '18px');
      if (index === 0) await dialog.screenshot({ path: `test-results/dialog-${adapter}.png` });
      await dialog.getByLabel('Top', { exact: true }).fill('0.5');
      await save.focus();
      await page.keyboard.press('Tab');
      await expect
        .poll(() => dialog.evaluate((el) => el.contains(el.ownerDocument.activeElement)))
        .toBe(true);
      await save.click();
      await expect(dialog).toHaveCount(0);
      await expect(file).toBeFocused();
      await file.click();
      await editor.getByRole('menuitem', { name: /Page setup/i }).click();
      await expect(dialog.getByLabel('Top', { exact: true })).toHaveValue('0.5');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(file).toBeFocused();
    }
  });
}

for (const [adapter, port] of [
  ['React', 5273],
  ['Vue', 5274],
] as const) {
  test(`${adapter}: Field Options cancels without changing the selected field`, async ({
    page,
  }) => {
    await page.goto(`http://localhost:${port}/?fixture=formtext-selection.docx`);
    const field = page.locator('[data-field-atom="form"]').first();
    await expect(field).toBeVisible();
    const before = await field.textContent();
    await field.click({ button: 'right' });
    await page.locator('[data-slot="field.edit"]').click();
    const dialog = page.locator('dialog[data-docx-dialog="textFormField"]');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-docx-field="defaultText"] input').fill('Different field default');
    await dialog.locator('[data-docx-part="cancel"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(field).toHaveText(before!);
    await field.click({ button: 'right' });
    await page.locator('[data-slot="field.edit"]').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-docx-field="defaultText"] input')).not.toHaveValue(
      'Different field default'
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
}
