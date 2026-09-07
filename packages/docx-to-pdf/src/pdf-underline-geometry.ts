/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { PdfLinkCommand, PdfPaintCommand, PdfRect } from './pdf-paint-types.ts';

/**
 * Word's PDF exporter quantizes path geometry to 300 dpi.
 * One device pixel is 72/300 pt. This is Word's grid, not the intended thickness.
 */
export const WORD_PDF_DEVICE_GRID_PT = 72 / 300;

/**
 * Adjacent single-underline runs join when their edges are within this gap.
 * An ordinary space is several points wide, so a skipped space does not join.
 */
export const PDF_UNDERLINE_JOIN_EPSILON_PT = 0.25;

/**
 * Adobe standard-14 AFM underline metrics (1000-unit em).
 * Helvetica, Times-Roman, and Courier all publish these values.
 */
export const PDF_STANDARD_UNDERLINE_METRICS: PdfUnderlineMetrics = Object.freeze({
  unitsPerEm: 1000,
  underlinePosition: -100,
  underlineThickness: 50,
});

/** OpenType `post` / `head` underline metrics in font units. @internal */
export interface PdfUnderlineMetrics {
  readonly unitsPerEm: number;
  /** `post.underlinePosition`. Negative values sit below the baseline. */
  readonly underlinePosition: number;
  readonly underlineThickness: number;
}

/** Continuous single-underline geometry in points. @internal */
export interface PdfSingleUnderlineGeometry {
  readonly thicknessPt: number;
  /** Distance from the baseline down to the top of the filled rule. */
  readonly offsetTopPt: number;
}

/** One candidate single-underline fill before or after merging. @internal */
export interface PdfUnderlineSegment {
  readonly pageIndex: number;
  readonly x: number;
  readonly width: number;
  readonly baseline: number;
  readonly color: string;
  readonly thicknessPt: number;
  readonly offsetTopPt: number;
  readonly linkKey: string | null;
}

const MAX_SFNT_TABLES = 4096;
const MAX_TTC_FACES = 256;
const TTC_VERSION_1 = 0x00010000;
const TTC_VERSION_2 = 0x00020000;

function readUint16(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset > bytes.byteLength - 2) return null;
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readInt16(bytes: Uint8Array, offset: number): number | null {
  const value = readUint16(bytes, offset);
  if (value === null) return null;
  return value > 32767 ? value - 65536 : value;
}

function readUint32(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset > bytes.byteLength - 4) return null;
  return (
    (bytes[offset]! * 0x1000000 +
      (bytes[offset + 1]! << 16) +
      (bytes[offset + 2]! << 8) +
      bytes[offset + 3]!) >>>
    0
  );
}

function tagAt(bytes: Uint8Array, offset: number): string | null {
  if (offset < 0 || offset > bytes.byteLength - 4) return null;
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!
  );
}

function isFontCollection(bytes: Uint8Array): boolean {
  return tagAt(bytes, 0) === 'ttcf';
}

function collectionFaceOffset(bytes: Uint8Array, faceIndex: number): number | null {
  if (bytes.byteLength < 12) return null;
  const version = readUint32(bytes, 4);
  if (version !== TTC_VERSION_1 && version !== TTC_VERSION_2) return null;
  const faceCount = readUint32(bytes, 8);
  if (faceCount === null || faceCount === 0 || faceCount > MAX_TTC_FACES) return null;
  if (!Number.isSafeInteger(faceIndex) || faceIndex < 0 || faceIndex >= faceCount) return null;
  const offsetsEnd = 12 + faceCount * 4;
  if (offsetsEnd > bytes.byteLength) return null;
  const faceOffset = readUint32(bytes, 12 + faceIndex * 4);
  if (faceOffset === null || faceOffset < offsetsEnd || faceOffset > bytes.byteLength - 12) {
    return null;
  }
  return faceOffset;
}

function sfntTableOffset(
  bytes: Uint8Array,
  base: number,
  wanted: string
): { readonly offset: number; readonly length: number } | null {
  const tableCount = readUint16(bytes, base + 4);
  if (tableCount === null || tableCount > MAX_SFNT_TABLES) return null;
  const directoryEnd = base + 12 + tableCount * 16;
  if (directoryEnd > bytes.byteLength) return null;
  for (let index = 0; index < tableCount; index += 1) {
    const record = base + 12 + index * 16;
    if (tagAt(bytes, record) !== wanted) continue;
    const offset = readUint32(bytes, record + 8);
    const length = readUint32(bytes, record + 12);
    if (
      offset === null ||
      length === null ||
      offset > bytes.byteLength ||
      length > bytes.byteLength - offset
    ) {
      return null;
    }
    return { offset, length };
  }
  return null;
}

/**
 * Rounds a continuous length onto Word's 0.24 pt PDF device grid.
 * Tests use this to separate intended values from Word's exporter quantization.
 */
export function quantizeWordPdfDeviceGrid(valuePt: number): number {
  return Math.round(valuePt / WORD_PDF_DEVICE_GRID_PT) * WORD_PDF_DEVICE_GRID_PT;
}

/**
 * Continuous single-underline thickness and top offset from OpenType `post` metrics.
 *
 * Word PDFs then round each length to {@link WORD_PDF_DEVICE_GRID_PT}. This helper
 * returns the unrounded intended values.
 */
export function pdfSingleUnderlineGeometry(
  fontSizePt: number,
  metrics: PdfUnderlineMetrics = PDF_STANDARD_UNDERLINE_METRICS
): PdfSingleUnderlineGeometry {
  const em = metrics.unitsPerEm;
  if (!(fontSizePt > 0) || !(em > 0)) {
    return Object.freeze({ thicknessPt: 0, offsetTopPt: 0 });
  }
  const thicknessPt = Math.abs((fontSizePt * metrics.underlineThickness) / em);
  const offsetTopPt = Math.abs((fontSizePt * metrics.underlinePosition) / em);
  return Object.freeze({ thicknessPt, offsetTopPt });
}

/** Reads `head.unitsPerEm` and `post` underline metrics from an admitted SFNT face. */
export function pdfUnderlineMetricsFromSfnt(
  bytes: Uint8Array,
  faceIndex: number = 0
): PdfUnderlineMetrics | null {
  const base = isFontCollection(bytes) ? collectionFaceOffset(bytes, faceIndex) : 0;
  if (base === null) return null;
  if (!isFontCollection(bytes) && faceIndex !== 0) return null;
  const head = sfntTableOffset(bytes, base, 'head');
  const post = sfntTableOffset(bytes, base, 'post');
  if (!head || head.length < 20 || !post || post.length < 12) return null;
  const unitsPerEm = readUint16(bytes, head.offset + 18);
  const underlinePosition = readInt16(bytes, post.offset + 8);
  const underlineThickness = readInt16(bytes, post.offset + 10);
  if (unitsPerEm === null || underlinePosition === null || underlineThickness === null) {
    return null;
  }
  if (!(unitsPerEm > 0) || underlineThickness === 0) return null;
  return Object.freeze({ unitsPerEm, underlinePosition, underlineThickness });
}

/** Identity for a link command that follows a text span, or null when the span is not a link. */
export function pdfUnderlineLinkKey(command: PdfPaintCommand | undefined): string | null {
  if (!command || command.kind !== 'link') return null;
  return linkTargetKey(command);
}

function linkTargetKey(command: PdfLinkCommand): string {
  if (command.target.kind === 'external') return `external:${command.target.href}`;
  return `internal:${command.target.destination}`;
}

/**
 * True when two single-underline fills may become one continuous rule.
 * Page, baseline, colour, thickness, offset, link identity, and x-continuity must match.
 */
export function canMergeSingleUnderlineRuns(
  left: PdfUnderlineSegment,
  right: PdfUnderlineSegment
): boolean {
  if (left.pageIndex !== right.pageIndex) return false;
  if (left.linkKey !== right.linkKey) return false;
  if (left.color !== right.color) return false;
  if (left.baseline !== right.baseline) return false;
  if (left.thicknessPt !== right.thicknessPt) return false;
  if (left.offsetTopPt !== right.offsetTopPt) return false;
  const leftRight = left.x + left.width;
  const rightRight = right.x + right.width;
  if (right.x > leftRight + PDF_UNDERLINE_JOIN_EPSILON_PT) return false;
  if (left.x > rightRight + PDF_UNDERLINE_JOIN_EPSILON_PT) return false;
  return true;
}

/** Extends `left` so it covers `right` as well. */
export function extendSingleUnderlineRun(
  left: PdfUnderlineSegment,
  right: PdfUnderlineSegment
): PdfUnderlineSegment {
  const x = Math.min(left.x, right.x);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  return Object.freeze({
    ...left,
    x,
    width: rightEdge - x,
  });
}

/** PDF user-space fill for one merged single underline. Origin is the page lower-left. */
export function pdfUnderlineFillRect(segment: PdfUnderlineSegment): PdfRect {
  return Object.freeze({
    x: segment.x,
    y: segment.baseline - segment.offsetTopPt - segment.thicknessPt,
    width: segment.width,
    height: segment.thicknessPt,
  });
}
