/**
 * Image Round-Trip Tests
 *
 * Regression test for GitHub issue #45: Image is lost on save.
 *
 * The root cause was that image dimensions were stored in pixels in ProseMirror
 * attributes but written back as EMU (English Metric Units) without conversion,
 * resulting in microscopically small images that appeared "lost".
 *
 * These tests verify that images survive a load → save round-trip with
 * correct dimensions and proper file references.
 */

import { test, expect } from '@playwright/test';
import { EditorPage } from '../helpers/editor-page';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EXAMPLE_DOCX = path.join(__dirname, '..', 'fixtures', 'example-with-image.docx');

/**
 * Load a DOCX file using the specific .docx file input (not the image input)
 */
async function loadDocx(editor: EditorPage, filePath: string) {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(__dirname, '..', filePath);
  const fileInput = editor.page.locator('input[type="file"][accept=".docx"]');
  await fileInput.setInputFiles(absolutePath);
  await editor.waitForReady();
}

test.describe('Image Round-Trip (Issue #45)', () => {
  let editor: EditorPage;

  test.beforeEach(async ({ page }) => {
    editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForReady();
  });

  test('image is visible after loading document', async ({ page }) => {
    await loadDocx(editor, EXAMPLE_DOCX);

    // The document has an inline image - verify it's rendered in the visible pages
    const images = page.locator('.paged-editor__pages img');
    await expect(images.first()).toBeVisible({ timeout: 10000 });

    // Verify the image has reasonable dimensions (not microscopic)
    const box = await images.first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);
  });

  test('image survives save round-trip with correct dimensions', async ({ page }) => {
    await loadDocx(editor, EXAMPLE_DOCX);

    // Wait for image to render
    const images = page.locator('.paged-editor__pages img');
    await expect(images.first()).toBeVisible({ timeout: 10000 });

    // Trigger save and capture the downloaded file
    const downloadPromise = page.waitForEvent('download');

    // Click the Save button
    await page.locator('text=Save').click();

    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Read the saved DOCX and inspect it
    const savedBuffer = fs.readFileSync(downloadPath!);
    const zip = await JSZip.loadAsync(savedBuffer);

    // 1. Verify the media file is still in the ZIP
    const mediaFile = zip.file('word/media/image1.png');
    expect(mediaFile).not.toBeNull();
    const mediaData = await mediaFile!.async('arraybuffer');
    expect(mediaData.byteLength).toBeGreaterThan(0);

    // 2. Verify document.xml still contains the drawing element
    const docXml = await zip.file('word/document.xml')!.async('text');
    expect(docXml).toContain('w:drawing');
    expect(docXml).toContain('a:blip');
    expect(docXml).toContain('r:embed');

    // 3. Verify the image dimensions are in EMU range (not pixel range)
    // Original: cx="3175000" cy="3497406" (~250x275 pixels at 96dpi)
    // Bug would produce cx="333" cy="367" (pixel values, not EMU)
    const extMatch = docXml.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    expect(extMatch).not.toBeNull();
    const cx = parseInt(extMatch![1], 10);
    const cy = parseInt(extMatch![2], 10);

    // EMU values should be > 100000 (images are at least ~1 inch)
    // Pixel values would be < 1000
    expect(cx).toBeGreaterThan(100000);
    expect(cy).toBeGreaterThan(100000);

    // Verify they're close to the originals (within 1% due to px/emu rounding)
    expect(cx).toBeGreaterThan(3100000);
    expect(cx).toBeLessThan(3250000);
    expect(cy).toBeGreaterThan(3400000);
    expect(cy).toBeLessThan(3600000);

    // 4. Verify wp:extent also has correct EMU values
    const wpExtentMatch = docXml.match(/<wp:extent cx="(\d+)" cy="(\d+)"/);
    expect(wpExtentMatch).not.toBeNull();
    const wpCx = parseInt(wpExtentMatch![1], 10);
    const wpCy = parseInt(wpExtentMatch![2], 10);
    expect(wpCx).toBeGreaterThan(100000);
    expect(wpCy).toBeGreaterThan(100000);

    // 5. Verify the relationship is preserved
    const relsXml = await zip.file('word/_rels/document.xml.rels')!.async('text');
    expect(relsXml).toContain('image');
    expect(relsXml).toContain('media/image1.png');
  });

  test('image is visible after loading a saved round-tripped file', async ({ page }) => {
    await loadDocx(editor, EXAMPLE_DOCX);

    // Wait for image to render
    const images = page.locator('.paged-editor__pages img');
    await expect(images.first()).toBeVisible({ timeout: 10000 });

    // Record original image dimensions
    const originalBox = await images.first().boundingBox();
    expect(originalBox).not.toBeNull();

    // Save the document
    const downloadPromise = page.waitForEvent('download');
    await page.locator('text=Save').click();
    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Re-load the saved file
    const savedBuffer = fs.readFileSync(downloadPath!);
    const tempPath = path.join(__dirname, '..', 'fixtures', '_temp-roundtripped.docx');
    fs.writeFileSync(tempPath, savedBuffer);

    try {
      await loadDocx(editor, tempPath);

      // Verify image is still visible after round-trip
      const roundTrippedImages = page.locator('.paged-editor__pages img');
      await expect(roundTrippedImages.first()).toBeVisible({ timeout: 10000 });

      // Verify dimensions are reasonable (within 5% of original)
      const roundTrippedBox = await roundTrippedImages.first().boundingBox();
      expect(roundTrippedBox).not.toBeNull();
      expect(roundTrippedBox!.width).toBeGreaterThan(originalBox!.width * 0.95);
      expect(roundTrippedBox!.width).toBeLessThan(originalBox!.width * 1.05);
      expect(roundTrippedBox!.height).toBeGreaterThan(originalBox!.height * 0.95);
      expect(roundTrippedBox!.height).toBeLessThan(originalBox!.height * 1.05);
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }
  });
});
