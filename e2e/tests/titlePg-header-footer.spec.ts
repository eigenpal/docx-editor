import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';

const FIXTURE = 'fixtures/titlePg-header-footer.docx';

test.describe('titlePg Header/Footer Per-Page Rendering', () => {
  test('renders first-page header with image on page 1', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number="1"]');
    await page.waitForTimeout(1500);

    // Page 1 header should contain an image (the logo from the 'first' header)
    const page1Header = page.locator('[data-page-number="1"] .layout-page-header');
    const headerImg = page1Header.locator('img');
    await expect(headerImg).toHaveCount(1);
    const imgSrc = await headerImg.getAttribute('src');
    expect(imgSrc).toBeTruthy();
    expect(imgSrc!.startsWith('data:')).toBe(true);
  });

  test('renders first-page footer text on page 1', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number="1"]');
    await page.waitForTimeout(1500);

    // Page 1 footer should contain the first-page footer text
    const page1Footer = page.locator('[data-page-number="1"] .layout-page-footer');
    const footerText = await page1Footer.textContent();
    expect(footerText).toContain('Some address');
    expect(footerText).toContain('phone');
    expect(footerText).toContain('website');
  });

  test('does not show default header text on page 1', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();

    await page.locator('input[type="file"][accept=".docx"]').setInputFiles(`e2e/${FIXTURE}`);
    await page.waitForSelector('.paged-editor__pages');
    await page.waitForSelector('[data-page-number="1"]');
    await page.waitForTimeout(1500);

    // Page 1 header should NOT contain the default header text
    const page1Header = page.locator('[data-page-number="1"] .layout-page-header');
    const headerText = await page1Header.textContent();
    expect(headerText).not.toContain('Second header onwards');
  });
});
