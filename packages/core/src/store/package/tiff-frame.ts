// The first frame of a TIFF as RGBA, for the hosts that convert TIFF pictures to PNG. DOM-free:
// the browser port encodes the frame with a canvas, the server port without one.

import type { ImageResourceLimits } from '../runtime/limits.ts';

/** The slice of the TIFF decoder this reads. IFDs are read before any pixels are touched. */
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

/** A decoded TIFF frame. */
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
