/**
 * TIFF to PNG Converter
 *
 * Converts TIFF image data to PNG using utif2 decoder + Canvas API.
 * Falls back gracefully in environments without Canvas (e.g., Node.js).
 */

import * as UTIF from 'utif2';

/**
 * Check if a MIME type is TIFF
 */
export function isTiffMimeType(mimeType: string): boolean {
  return mimeType === 'image/tiff' || mimeType === 'image/tif';
}

/**
 * Convert TIFF ArrayBuffer to a PNG data URL.
 * Returns null if conversion fails or Canvas API is unavailable.
 */
export function convertTiffToPngDataUrl(tiffData: ArrayBuffer): string | null {
  try {
    // Decode the TIFF file
    const ifds = UTIF.decode(tiffData);
    if (ifds.length === 0) return null;

    // Decode the first image in the TIFF
    const firstImage = ifds[0];
    UTIF.decodeImage(tiffData, firstImage);
    const rgba = UTIF.toRGBA8(firstImage);

    const width = firstImage.width;
    const height = firstImage.height;
    if (!width || !height || rgba.length === 0) return null;

    // Use Canvas API to convert RGBA pixels to PNG
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null; // No DOM available (Node.js headless without canvas)
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const clamped = new Uint8ClampedArray(rgba.length);
    clamped.set(rgba);
    const imageData = new ImageData(clamped, width, height);
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/png');
  } catch (error) {
    console.warn('[tiffConverter] Failed to convert TIFF to PNG:', error);
    return null;
  }
}
