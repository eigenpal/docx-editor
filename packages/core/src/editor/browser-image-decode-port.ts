// Browser image decode port for embedded drawing resources (typed-drawings-and-images task 6).
//
// Validates through the same decode contract as tests; layout never reads raw bytes directly.

import type {
  ImageDecodePort,
  MetafileImageMime,
  SupportedImageMime,
} from '../store/package/image-resources.ts';
import type { ImageResourceLimits } from '../store/runtime/limits.ts';

/** Output bounds handed to the metafile rasterizer — well under every resource pixel cap. */
const MAX_METAFILE_RASTER_EDGE = 4096;

/**
 * Decode raster headers in the browser via `createImageBitmap`, or null when unavailable.
 * Also converts EMF/WMF metafiles to PNG through the lazily loaded `emf-converter`
 * rasterizer; the resource layer re-runs the converted bytes through the full raster
 * validation path before they can become a ready resource.
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
    convertMetafile: convertBrowserMetafile,
  });
}

/**
 * EMF/WMF → PNG through `emf-converter` (Canvas-based, lazily imported so only documents
 * that contain metafiles load it). Exported for direct unit coverage — the port factory
 * gates on `createImageBitmap`, which headless DOMs lack.
 */
export async function convertBrowserMetafile(
  bytes: Uint8Array,
  mime: MetafileImageMime,
  _limits: ImageResourceLimits
): Promise<Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }> | null> {
  const { convertEmfToDataUrl, convertWmfToDataUrl } = await import('emf-converter');
  const copy = new Uint8Array(bytes);
  const buffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength);
  const options = { maxWidth: MAX_METAFILE_RASTER_EDGE, maxHeight: MAX_METAFILE_RASTER_EDGE };
  const dataUrl =
    mime === 'image/x-emf'
      ? await convertEmfToDataUrl(buffer, options)
      : await convertWmfToDataUrl(buffer, options);
  if (!dataUrl) return null;
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) return null;
  const binary = atob(dataUrl.slice(prefix.length));
  const pngBytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    pngBytes[index] = binary.charCodeAt(index);
  }
  return Object.freeze({ bytes: pngBytes, mime: 'image/png' as const });
}

/** Headless fallback: embedded images resolve to unrenderable, never ready. */
export function createHeadlessImageDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode() {
      throw new Error('Image decode unavailable in headless environment');
    },
  });
}
