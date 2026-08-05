// Browser image decode port for embedded drawing resources (typed-drawings-and-images task 6).
//
// Validates through the same decode contract as tests; layout never reads raw bytes directly.

import type { ImageDecodePort, SupportedImageMime } from '../store/package/image-resources.ts';
import type { ImageResourceLimits } from '../store/runtime/limits.ts';

/**
 * Decode raster headers in the browser via `createImageBitmap`, or null when unavailable.
 */
export function tryCreateBrowserImageDecodePort(ownerDocument: Document): ImageDecodePort | null {
  if (typeof ownerDocument.defaultView?.createImageBitmap !== 'function') return null;
  const view = ownerDocument.defaultView!;
  return Object.freeze({
    async decode(bytes: Uint8Array, mime: SupportedImageMime, limits: ImageResourceLimits) {
      const blob = new Blob([new Uint8Array(bytes)], { type: mime });
      const bitmap = await view.createImageBitmap!(blob);
      try {
        const pixelWidth = bitmap.width;
        const pixelHeight = bitmap.height;
        if (pixelWidth <= 0 || pixelHeight <= 0) {
          throw new Error('image dimensions invalid');
        }
        if (pixelWidth * pixelHeight > limits.maxPixels) {
          throw new Error('image dimensions exceed limits');
        }
        return Object.freeze({ pixelWidth, pixelHeight, dpiX: 96, dpiY: 96 });
      } finally {
        bitmap.close();
      }
    },
  });
}

/** Headless fallback: embedded images resolve to unrenderable, never ready. */
export function createHeadlessImageDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode() {
      throw new Error('Image decode unavailable in headless environment');
    },
  });
}
