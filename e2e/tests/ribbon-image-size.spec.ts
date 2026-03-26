import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_IMAGE = path.join(__dirname, '..', 'fixtures', 'test-image.png');

test.describe('Ribbon - Image Size', () => {
  test('opens image size dialog and applies width/height', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    const imageInput = page.locator('input[type="file"][accept*="image"]');
    await imageInput.setInputFiles(TEST_IMAGE);

    const image = page.locator('.paged-editor__pages img').first();
    await expect(image).toBeVisible();
    await image.click();

    await page.getByRole('tab', { name: 'Picture Format' }).click();
    await page.getByTestId('ribbon-imageWidth').click();

    const dialog = page.getByTestId('image-size-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('image-size-width')).toBeFocused();

    const lockButton = dialog.getByTestId('image-size-lock');
    const isLocked = (await lockButton.getAttribute('aria-pressed')) === 'true';
    if (isLocked) {
      await lockButton.click();
    }

    await dialog.getByTestId('image-size-width').fill('200');
    await dialog.getByTestId('image-size-height').fill('100');
    await dialog.getByRole('button', { name: 'Apply' }).click();

    await page.waitForTimeout(150);
    const box = await image.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBeCloseTo(200, 1);
    expect(Math.round(box!.height)).toBeCloseTo(100, 1);
  });

  test('aspect ratio lock adjusts linked dimension', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    const imageInput = page.locator('input[type="file"][accept*="image"]');
    await imageInput.setInputFiles(TEST_IMAGE);

    const image = page.locator('.paged-editor__pages img').first();
    await expect(image).toBeVisible();
    await image.click();

    await page.getByRole('tab', { name: 'Picture Format' }).click();
    await page.getByTestId('ribbon-aspectRatio').click();

    const dialog = page.getByTestId('image-size-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('image-size-lock')).toBeFocused();

    const lockButton = dialog.getByTestId('image-size-lock');
    const isLocked = (await lockButton.getAttribute('aria-pressed')) === 'true';
    if (!isLocked) {
      await lockButton.click();
    }

    await dialog.getByTestId('image-size-width').fill('300');

    const heightValue = await dialog.getByTestId('image-size-height').inputValue();
    expect(Number(heightValue)).toBeGreaterThan(0);
  });

  test('image height button focuses height input', async ({ page }) => {
    const editor = new EditorPage(page);
    await page.goto('/?toolbar=ribbon');
    await editor.waitForReady();

    const imageInput = page.locator('input[type="file"][accept*="image"]');
    await imageInput.setInputFiles(TEST_IMAGE);

    const image = page.locator('.paged-editor__pages img').first();
    await expect(image).toBeVisible();
    await image.click();

    await page.getByRole('tab', { name: 'Picture Format' }).click();
    await page.getByTestId('ribbon-imageHeight').click();

    const dialog = page.getByTestId('image-size-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('image-size-height')).toBeFocused();
  });
});
