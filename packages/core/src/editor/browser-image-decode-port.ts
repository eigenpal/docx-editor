// Browser image decode port for embedded drawing resources (typed-drawings-and-images task 6).
//
// Validates through the same decode contract as tests; layout never reads raw bytes directly.

import type {
  ImageDecodePort,
  MetafileImageMime,
  PreservedImageMime,
  SupportedImageMime,
} from '../store/package/image-resources.ts';
import type { ImageResourceLimits } from '../store/runtime/limits.ts';

/** Output bounds handed to the metafile rasterizer — well under every resource pixel cap. */
const MAX_METAFILE_RASTER_EDGE = 4096;

/** A converted raster, or null when the format was declined and the placeholder stands. */
type ConvertedRaster = Readonly<{ bytes: Uint8Array; mime: SupportedImageMime }> | null;

/**
 * Decode raster headers in the browser via `createImageBitmap`, or null when unavailable.
 * Also converts the formats an `<img>` cannot render — EMF/WMF metafiles through the
 * lazily loaded `emf-converter` rasterizer, TIFF through a lazily loaded TIFF decoder —
 * into PNG; the resource layer re-runs the converted bytes through the full raster
 * validation path before they can become a ready resource.
 */
export function tryCreateBrowserImageDecodePort(ownerDocument: Document): ImageDecodePort | null {
  if (typeof ownerDocument.defaultView?.createImageBitmap !== 'function') return null;
  const view = ownerDocument.defaultView!;
  return Object.freeze({
    async decode(bytes: Uint8Array, mime: SupportedImageMime, limits: ImageResourceLimits) {
      const blob = new Blob([new Uint8Array(bytes)], { type: mime });
      // `validateJpegHeader` reports the extent AFTER EXIF orientation; the bitmap must be
      // oriented the same way or the two disagree on portrait photos.
      const bitmap = await view.createImageBitmap!(blob, { imageOrientation: 'from-image' });
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
    convertPreserved(
      bytes: Uint8Array,
      mime: PreservedImageMime,
      limits: ImageResourceLimits
    ): Promise<ConvertedRaster> {
      return mime === 'image/tiff'
        ? convertBrowserTiff(ownerDocument, bytes, limits)
        : convertBrowserMetafile(bytes, mime, limits);
    },
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

/** The slice of the TIFF decoder this port uses. IFDs are read before any pixels are touched. */
interface TiffImageDirectory {
  readonly width: number;
  readonly height: number;
  readonly [tag: string]: unknown;
}

interface TiffDecoderModule {
  decode(buffer: ArrayBuffer): TiffImageDirectory[];
  decodeImage(buffer: ArrayBuffer, ifd: TiffImageDirectory): void;
  toRGBA8(ifd: TiffImageDirectory): Uint8Array;
}

/** First element of a TIFF tag value, when it is a positive integer. */
function tiffTagInteger(directory: TiffImageDirectory, tag: string): number | null {
  const value = directory[tag];
  if (!Array.isArray(value) || value.length === 0) return null;
  const first = Number(value[0]);
  return Number.isSafeInteger(first) && first > 0 ? first : null;
}

/** A decoded TIFF frame, ready for a canvas. */
export interface DecodedTiffFrame {
  readonly rgba: Uint8Array;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

/**
 * First TIFF frame as RGBA, lazily importing the decoder so only documents that contain
 * one load it. Null when the bytes carry no decodable image or exceed the limits.
 *
 * The declared extent is read from the first IFD and checked against the resource limits
 * before any pixel buffer is allocated, and the decoded buffer must match that extent
 * exactly — a decoder that reports one size and returns another is refused rather than
 * trusted. Only the first image is read: Word paints page one of a multi-page TIFF.
 */
export async function decodeTiffFrame(
  bytes: Uint8Array,
  limits: ImageResourceLimits
): Promise<DecodedTiffFrame | null> {
  const imported = (await import('utif2')) as unknown as TiffDecoderModule & {
    default?: TiffDecoderModule;
  };
  const decoder = imported.default ?? imported;
  // One copy, not two: `slice` already detaches from the caller's buffer and rebases to 0,
  // so its `buffer` is exactly the region the decoder should see. TIFFs run to megabytes.
  const buffer = bytes.slice().buffer;

  const page = decoder.decode(buffer)[0];
  if (!page) return null;
  const pixelWidth = tiffTagInteger(page, 't256');
  const pixelHeight = tiffTagInteger(page, 't257');
  if (pixelWidth === null || pixelHeight === null) return null;
  if (pixelWidth > limits.maxDimension || pixelHeight > limits.maxDimension) return null;
  if (pixelWidth > limits.maxPixels / pixelHeight) return null;
  const pixelCount = pixelWidth * pixelHeight;
  if (pixelCount * 4 > limits.maxDecodedBytes) return null;

  decoder.decodeImage(buffer, page);
  if (page.width !== pixelWidth || page.height !== pixelHeight) return null;
  const rgba = decoder.toRGBA8(page);
  if (rgba.length !== pixelCount * 4) return null;
  return Object.freeze({ rgba, pixelWidth, pixelHeight });
}

/**
 * TIFF → PNG. Exported for direct unit coverage — the port factory gates on
 * `createImageBitmap`, which headless DOMs lack.
 */
export async function convertBrowserTiff(
  ownerDocument: Document,
  bytes: Uint8Array,
  limits: ImageResourceLimits
): Promise<ConvertedRaster> {
  const frame = await decodeTiffFrame(bytes, limits);
  if (frame === null) return null;
  const png = await encodeRgbaAsPng(ownerDocument, frame.rgba, frame.pixelWidth, frame.pixelHeight);
  return png === null ? null : Object.freeze({ bytes: png, mime: 'image/png' as const });
}

/** RGBA → PNG bytes through a canvas, or null when this document cannot encode them. */
async function encodeRgbaAsPng(
  ownerDocument: Document,
  rgba: Uint8Array,
  pixelWidth: number,
  pixelHeight: number
): Promise<Uint8Array | null> {
  const canvas = ownerDocument.createElement('canvas');
  canvas.width = pixelWidth;
  canvas.height = pixelHeight;
  // Browsers CLAMP an oversized canvas rather than refusing it, and the clamp is silent —
  // the surface just comes back smaller. Encoding into it would produce a valid PNG of the
  // wrong size, which then passes every downstream check and paints a cropped picture
  // stretched over the authored extent. Refusing keeps the labelled placeholder, which is
  // the honest answer.
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) return null;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const imageData = context.createImageData(pixelWidth, pixelHeight);
  imageData.data.set(rgba);
  context.putImageData(imageData, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png');
  });
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}

/** Headless fallback: embedded images resolve to unrenderable, never ready. */
export function createHeadlessImageDecodePort(): ImageDecodePort {
  return Object.freeze({
    async decode() {
      throw new Error('Image decode unavailable in headless environment');
    },
  });
}
