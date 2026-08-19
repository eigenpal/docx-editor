import { expect, test } from '@playwright/test';

const ADAPTERS = [
  { name: 'React', url: 'http://localhost:5273/' },
  { name: 'Vue', url: 'http://localhost:5274/' },
] as const;

for (const adapter of ADAPTERS) {
  test(`${adapter.name} demo opens and renders the composed editor`, async ({ page }) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') runtimeErrors.push(message.text());
    });

    await page.goto(adapter.url);

    await expect(page.getByTestId('composed-mount')).toBeVisible();
    await expect(page.locator('.docx-page').first()).toBeVisible();
    await expect(page.locator('.docx-page')).toHaveCount(27);
    await expect(page.getByRole('textbox', { name: 'Document title' })).toHaveValue('sample');

    const link = page.getByRole('button', { name: /^Insert link/ });
    await expect(link).toBeEnabled();
    await link.click();
    await expect(page.getByRole('textbox', { name: 'https://example.com' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('menuitem', { name: 'File' }).click();
    await expect(page.getByRole('menu', { name: 'File' })).toBeVisible();
    expect(runtimeErrors).toEqual([]);
  });
}
