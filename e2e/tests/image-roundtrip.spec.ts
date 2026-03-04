/**
 * Image Round-Trip Tests
 *
 * Regression tests for:
 * - GitHub issue #45: Image lost on save (px→EMU conversion missing)
 * - Newly inserted images not written to DOCX media (missing binary + rels)
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const EXAMPLE_DOCX = path.join(__dirname, '..', 'fixtures', 'example-with-image.docx');
const TEST_IMAGE = path.join(__dirname, '..', 'fixtures', 'test-image.png');

test.describe('Image Round-Trip (Issue #45)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
  });

  test('existing image survives save with correct EMU dimensions', async ({ page }) => {
    await editor.loadDocxFile(EXAMPLE_DOCX);

    const images = page.locator('.paged-editor__pages img');
    await expect(images.first()).toBeVisible({ timeout: 10000 });

    // Save and capture download
    const downloadPromise = page.waitForEvent('download');
    await page.locator('text=Save').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const zip = await JSZip.loadAsync(fs.readFileSync(downloadPath!));

    // Media file preserved
    const mediaFile = zip.file('word/media/image1.png');
    expect(mediaFile).not.toBeNull();
    expect((await mediaFile!.async('arraybuffer')).byteLength).toBeGreaterThan(0);

    // Drawing XML preserved
    const docXml = await zip.file('word/document.xml')!.async('text');
    expect(docXml).toContain('w:drawing');
    expect(docXml).toContain('a:blip');
    expect(docXml).toContain('r:embed');

    // Image dimensions are EMU (>100000), not pixels (<1000)
    const extMatch = docXml.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    expect(extMatch).not.toBeNull();
    expect(parseInt(extMatch![1], 10)).toBeGreaterThan(100000);
    expect(parseInt(extMatch![2], 10)).toBeGreaterThan(100000);

    const wpExtent = docXml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    expect(wpExtent).not.toBeNull();
    expect(parseInt(wpExtent![1], 10)).toBeGreaterThan(100000);
    expect(parseInt(wpExtent![2], 10)).toBeGreaterThan(100000);

    // Relationship preserved
    const relsXml = await zip.file('word/_rels/document.xml.rels')!.async('text');
    expect(relsXml).toContain('media/image1.png');
  });

  test('newly inserted image is saved with media, rels, and content type', async ({ page }) => {
    // Insert an image via the image file input
    const imageInput = page.locator('input[type="file"][accept*="image"]');
    await imageInput.setInputFiles(TEST_IMAGE);

    const images = page.locator('.paged-editor__pages img');
    await expect(images.first()).toBeVisible({ timeout: 10000 });

    // Save
    const downloadPromise = page.waitForEvent('download');
    await page.locator('text=Save').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const zip = await JSZip.loadAsync(fs.readFileSync(downloadPath!));

    // Binary exists in word/media/
    const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith('word/media/'));
    const pngFile = mediaFiles.find((f) => f.endsWith('.png'));
    expect(pngFile).toBeTruthy();
    expect((await zip.file(pngFile!)!.async('arraybuffer')).byteLength).toBeGreaterThan(0);

    // Drawing XML references the image
    const docXml = await zip.file('word/document.xml')!.async('text');
    expect(docXml).toContain('w:drawing');
    const blipMatch = docXml.match(/r:embed="(rId\d+)"/);
    expect(blipMatch).not.toBeNull();

    // Relationship exists for that rId
    const relsXml = await zip.file('word/_rels/document.xml.rels')!.async('text');
    expect(relsXml).toContain(`Id="${blipMatch![1]}"`);
    expect(relsXml).toContain('relationships/image');

    // Content type registered
    const ctXml = await zip.file('[Content_Types].xml')!.async('text');
    expect(ctXml).toContain('Extension="png"');

    // Dimensions are EMU, not pixels
    const extMatch = docXml.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    expect(extMatch).not.toBeNull();
    expect(parseInt(extMatch![1], 10)).toBeGreaterThan(100000);
    expect(parseInt(extMatch![2], 10)).toBeGreaterThan(100000);
  });

  test('existing image is visible after save round-trip reload', async ({ page }) => {
    await editor.loadDocxFile(EXAMPLE_DOCX);

    const images = page.locator('.paged-editor__pages img');
    await expect(images.first()).toBeVisible({ timeout: 10000 });
    const originalBox = await images.first().boundingBox();
    expect(originalBox).not.toBeNull();

    // Save
    const downloadPromise = page.waitForEvent('download');
    await page.locator('text=Save').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Re-load the saved file
    const tempPath = path.join(__dirname, '..', 'fixtures', '_temp-roundtripped.docx');
    fs.writeFileSync(tempPath, fs.readFileSync(downloadPath!));

    try {
      await editor.loadDocxFile(tempPath);

      const rtImages = page.locator('.paged-editor__pages img');
      await expect(rtImages.first()).toBeVisible({ timeout: 10000 });

      // Dimensions within 5% of original
      const rtBox = await rtImages.first().boundingBox();
      expect(rtBox).not.toBeNull();
      expect(rtBox!.width).toBeGreaterThan(originalBox!.width * 0.95);
      expect(rtBox!.width).toBeLessThan(originalBox!.width * 1.05);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
  });
});
