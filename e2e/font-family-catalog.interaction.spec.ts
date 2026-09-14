import { expect, test } from '@playwright/test';

const STANDARD_FONTS = [
  'Arial',
  'Calibri',
  'Cambria',
  'Consolas',
  'Courier New',
  'Garamond',
  'Georgia',
  'Helvetica',
  'Open Sans',
  'Roboto',
  'Times New Roman',
  'Verdana',
];

for (const adapter of ['react', 'vue'] as const) {
  test(`${adapter}: new documents retain the standard font choices`, async ({ page }, testInfo) => {
    const port = testInfo.config.metadata[`${adapter}Port`];
    await page.goto(`http://localhost:${port}/`);
    const trigger = page.locator('.docx-toolbar__font-family-trigger');
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const choices = page.locator('.docx-toolbar__font-family-content [role="option"]');
    for (const family of STANDARD_FONTS) {
      await expect(choices.filter({ hasText: new RegExp(`^${family}\\s*✓?$`) })).toHaveCount(1);
    }
    await trigger.click();

    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New', exact: true }).click();
    await expect(trigger).toHaveText('Calibri');
    await page.keyboard.press('Escape');
    await trigger.click();
    const blankChoices = (await choices.allTextContents()).map((name) =>
      name.replace('✓', '').trim()
    );
    expect(blankChoices.sort()).toEqual(STANDARD_FONTS);

    await choices.filter({ hasText: /^Arial\s*✓?$/ }).click();
    await expect(trigger).toHaveText('Arial');
    await expect(choices).toHaveCount(0);
    await page.locator('.docx-pages').pressSequentially('Text in the selected font');
    await expect(page.locator('.docx-pages')).toContainText('Text in the selected font');
    await trigger.click();
    const populatedChoices = (await choices.allTextContents()).map((name) =>
      name.replace('✓', '').trim()
    );
    expect(populatedChoices.sort()).toEqual(STANDARD_FONTS);
    await expect(choices.filter({ hasText: /^Arial\s*✓?$/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
}
