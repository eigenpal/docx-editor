// Client-side image preflight before `executeImageCommand`.
//
// Signature sniffing and dimension bounds mirror the package trust boundary; bytes are read
// once and passed through without creating object URLs.

import {
  DEFAULT_IMAGE_RESOURCE_LIMITS,
  sniffImageMime,
  validateRasterHeader,
  type SupportedImageMime,
} from '@docx-editor.dev/core/editor';

const EMU_PER_POINT = 12_700;
const DEFAULT_DPI = 96;
const MAX_PNG_METADATA_SCAN_BYTES = 65_536;

type RasterDpi = Readonly<{ dpiX: number; dpiY: number }>;

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) |
      (bytes[offset + 1]! << 16) |
      (bytes[offset + 2]! << 8) |
      bytes[offset + 3]!) >>>
    0
  );
}

/** Read a bounded PNG `pHYs` chunk. Invalid or implausible densities use the CSS default. */
function pngDpi(bytes: Uint8Array): RasterDpi | null {
  const scanEnd = Math.min(bytes.length, MAX_PNG_METADATA_SCAN_BYTES);
  let offset = 8;
  while (offset + 12 <= scanEnd) {
    const length = readUint32Be(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > scanEnd || chunkEnd < offset) return null;
    const isPhys =
      bytes[offset + 4] === 0x70 &&
      bytes[offset + 5] === 0x48 &&
      bytes[offset + 6] === 0x59 &&
      bytes[offset + 7] === 0x73;
    if (isPhys && length === 9 && bytes[offset + 16] === 1) {
      const dpiX = readUint32Be(bytes, offset + 8) * 0.0254;
      const dpiY = readUint32Be(bytes, offset + 12) * 0.0254;
      if (dpiX >= 10 && dpiX <= 2400 && dpiY >= 10 && dpiY <= 2400) {
        return { dpiX, dpiY };
      }
      return null;
    }
    offset = chunkEnd;
  }
  return null;
}

export type NormalizedImagePayload =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly mime: SupportedImageMime;
      readonly widthPoints: number;
      readonly heightPoints: number;
    }
  | {
      readonly ok: false;
      /** i18n key under `imageInsert.errors.*` suitable for `t()`. */
      readonly reasonKey: string;
    };

function isSupportedMime(mime: string): mime is SupportedImageMime {
  return mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/gif';
}

function naturalPoints(
  pixelWidth: number,
  pixelHeight: number,
  dpiX: number,
  dpiY: number
): {
  readonly widthPoints: number;
  readonly heightPoints: number;
} {
  const widthPoints = (pixelWidth * 72) / dpiX;
  const heightPoints = (pixelHeight * 72) / dpiY;
  return {
    widthPoints: Math.max(1, Math.round(widthPoints * 100) / 100),
    heightPoints: Math.max(1, Math.round(heightPoints * 100) / 100),
  };
}

/** Preflight raster bytes for insert/replace. Never allocates from file-supplied dimensions alone. */
export function normalizeImageBytes(bytes: Uint8Array): NormalizedImagePayload {
  const limits = DEFAULT_IMAGE_RESOURCE_LIMITS;
  if (bytes.byteLength === 0) {
    return { ok: false, reasonKey: 'imageInsert.errors.emptyFile' };
  }
  if (bytes.byteLength > limits.maxEncodedBytes) {
    return { ok: false, reasonKey: 'imageInsert.errors.oversize' };
  }
  const sniffed = sniffImageMime(bytes);
  if (!isSupportedMime(sniffed)) {
    if (sniffed === 'image/svg+xml' || sniffed === 'image/tiff') {
      return { ok: false, reasonKey: 'imageInsert.errors.unsupportedFormat' };
    }
    return { ok: false, reasonKey: 'imageInsert.errors.invalidSignature' };
  }
  const header = validateRasterHeader(bytes, sniffed);
  if (!header) {
    return { ok: false, reasonKey: 'imageInsert.errors.invalidSignature' };
  }
  const pixels = header.pixelWidth * header.pixelHeight;
  if (
    pixels > limits.maxPixels ||
    header.pixelWidth > limits.maxDimension ||
    header.pixelHeight > limits.maxDimension
  ) {
    return { ok: false, reasonKey: 'imageInsert.errors.oversize' };
  }
  const dpi = sniffed === 'image/png' ? pngDpi(bytes) : null;
  const { widthPoints, heightPoints } = naturalPoints(
    header.pixelWidth,
    header.pixelHeight,
    dpi?.dpiX ?? DEFAULT_DPI,
    dpi?.dpiY ?? DEFAULT_DPI
  );
  return Object.freeze({
    ok: true,
    bytes,
    mime: sniffed,
    widthPoints,
    heightPoints,
  });
}

/** Convert layout EMU to display points for properties UI. */
export function emuToPoints(emu: number): number {
  return Math.round((emu / EMU_PER_POINT) * 100) / 100;
}

/** Convert display points to layout EMU for engine commands. */
export function pointsToEmu(points: number): number {
  return Math.round(points * EMU_PER_POINT);
}
