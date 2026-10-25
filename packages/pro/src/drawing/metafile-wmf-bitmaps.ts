/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Device-independent bitmaps in a WMF, which the metafile replayer does not draw: each
// `META_STRETCHDIB`, `META_DIBSTRETCHBLT` and `META_DIBBITBLT`, decoded and placed in the
// replayed canvas. A copy (SRCCOPY) paints every pixel. A mask that combines with the page
// (SRCAND, SRCPAINT) paints the pixels that change a white page or a black one, and leaves
// the rest clear, as it shows over a plain page.
//
// Each bitmap paints at its record's place in the drawing order, in the window in force at its
// record. The replayer is handed a copy of the WMF whose bitmap records are text records with
// a marker; where the marker text is drawn is where the bitmap goes.
//
// The bytes are attacker-controlled. Every read is bounds-checked, record and pixel counts
// are capped, and anything outside the uncompressed subset is skipped.

import type { MetafileBudget, MetafileCommand } from './metafile-recording.ts';
import { MAX_METAFILE_PIXELS } from './metafile-recording.ts';

const PLACEABLE_KEY = 0x9ac6cdd7;
const META_SETWINDOWORG = 0x020b;
const META_SETWINDOWEXT = 0x020c;
const META_STRETCHDIB = 0x0f43;
const META_DIBSTRETCHBLT = 0x0b41;
const META_DIBBITBLT = 0x0940;
const META_TEXTOUT = 0x0521;
/** A marker's text: two control characters, then the bitmap's index. */
const MARKER_PREFIX = '\u0001\u007f';
const SRCCOPY = 0x00cc0020;
/** Destination AND source: white source pixels leave the page as it is. */
const SRCAND = 0x008800c6;
/** Destination OR source: black source pixels leave the page as it is. */
const SRCPAINT = 0x00ee0086;
const MAX_RECORDS = 200_000;

interface Placement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One bitmap record: its raster operation, rectangles, window, and where its DIB lies. */
interface PlacedBitmap {
  readonly rop: number;
  readonly source: Placement;
  readonly target: Placement;
  /** The window origin and extent in force at the record. */
  readonly window: Placement;
  readonly record: number;
  readonly dib: number;
  readonly end: number;
}

/** The bitmap records of a WMF, and the copy of it the replayer reads. */
export interface WmfBitmapScan {
  /** The WMF with each bitmap record turned into a text record that draws its marker. */
  readonly marked: Uint8Array;
  readonly placed: readonly PlacedBitmap[];
}

/**
 * A DIB (`BITMAPINFOHEADER` or `BITMAPCOREHEADER` and its bits) as RGBA, top row first, or
 * null. `topDown` says the DIB stored its rows from the top, so its source rows count from there.
 */
export function decodeDib(
  view: DataView,
  start: number,
  end: number
): { width: number; height: number; topDown: boolean; data: Uint8Array } | null {
  if (start + 12 > end) return null;
  const headerSize = view.getUint32(start, true);
  let width: number;
  let height: number;
  let bitCount: number;
  let compression = 0;
  let colorsUsed = 0;
  let paletteEntry = 4;
  if (headerSize === 12) {
    width = view.getUint16(start + 4, true);
    height = view.getUint16(start + 6, true);
    bitCount = view.getUint16(start + 10, true);
    paletteEntry = 3;
  } else if (headerSize >= 40 && start + headerSize <= end) {
    width = view.getInt32(start + 4, true);
    height = view.getInt32(start + 8, true);
    bitCount = view.getUint16(start + 14, true);
    compression = view.getUint32(start + 16, true);
    colorsUsed = view.getUint32(start + 32, true);
  } else return null;
  const topDown = height < 0;
  const rows = Math.abs(height);
  if (!(width > 0 && rows > 0) || width * rows > MAX_METAFILE_PIXELS) return null;
  if (compression !== 0 || ![1, 4, 8, 16, 24, 32].includes(bitCount)) return null;
  const paletteSize = bitCount <= 8 ? colorsUsed || 1 << bitCount : 0;
  const paletteStart = start + headerSize;
  const bitsStart = paletteStart + paletteSize * paletteEntry;
  const stride = Math.floor((width * bitCount + 31) / 32) * 4;
  if (paletteSize > 256 || bitsStart + stride * rows > end) return null;
  const palette = (index: number): [number, number, number] => {
    if (index >= paletteSize) return [0, 0, 0];
    const at = paletteStart + index * paletteEntry;
    return [view.getUint8(at + 2), view.getUint8(at + 1), view.getUint8(at)];
  };
  const data = new Uint8Array(width * rows * 4);
  for (let row = 0; row < rows; row += 1) {
    const source = bitsStart + (topDown ? row : rows - 1 - row) * stride;
    for (let column = 0; column < width; column += 1) {
      let rgb: [number, number, number];
      if (bitCount === 24) {
        const at = source + column * 3;
        rgb = [view.getUint8(at + 2), view.getUint8(at + 1), view.getUint8(at)];
      } else if (bitCount === 32) {
        const at = source + column * 4;
        rgb = [view.getUint8(at + 2), view.getUint8(at + 1), view.getUint8(at)];
      } else if (bitCount === 16) {
        const value = view.getUint16(source + column * 2, true);
        const five = (shift: number) => (((value >> shift) & 0x1f) * 255) / 31;
        rgb = [five(10), five(5), five(0)];
      } else {
        const bit = column * bitCount;
        const byte = view.getUint8(source + (bit >> 3));
        const index = (byte >> (8 - bitCount - (bit & 7))) & ((1 << bitCount) - 1);
        rgb = palette(index);
      }
      const out = (row * width + column) * 4;
      data[out] = rgb[0];
      data[out + 1] = rgb[1];
      data[out + 2] = rgb[2];
      data[out + 3] = 255;
    }
  }
  return { width, height: rows, topDown, data };
}

/** The bitmap index a replayed text names, or null when it is not a marker. */
export function wmfBitmapMarkerIndex(text: string): number | null {
  if (!text.startsWith(MARKER_PREFIX)) return null;
  const digits = text.slice(MARKER_PREFIX.length);
  return /^\d{1,6}$/.test(digits) ? Number(digits) : null;
}

/**
 * The bitmap records of a WMF, each with the window in force at it, and a copy of the WMF
 * whose bitmap records draw their markers instead. Null for an EMF or a WMF with none.
 */
export function scanWmfBitmaps(bytes: Uint8Array): WmfBitmapScan | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) return null;
  let at = 0;
  let window: Placement = { x: 0, y: 0, width: 0, height: 0 };
  if (view.getUint32(0, true) === PLACEABLE_KEY) {
    const left = view.getInt16(6, true);
    const top = view.getInt16(8, true);
    window = {
      x: left,
      y: top,
      width: view.getInt16(10, true) - left,
      height: view.getInt16(12, true) - top,
    };
    at = 22;
  }
  if (at + 18 > bytes.length) return null;
  at += view.getUint16(at + 2, true) * 2;
  const placed: PlacedBitmap[] = [];
  for (let records = 0; records < MAX_RECORDS && at + 6 <= bytes.length; records += 1) {
    const size = view.getUint32(at, true) * 2;
    const fn = view.getUint16(at + 4, true);
    if (fn === 0 || size < 6 || at + size > bytes.length) break;
    const word = (index: number) => view.getInt16(at + 6 + index * 2, true);
    if (fn === META_SETWINDOWORG && size >= 10) {
      window = { ...window, y: word(0), x: word(1) };
    } else if (fn === META_SETWINDOWEXT && size >= 10) {
      window = { ...window, height: word(0), width: word(1) };
    } else if (fn === META_STRETCHDIB && size >= 28) {
      // RasterOperation (2 words), ColorUsage, SrcHeight, SrcWidth, YSrc, XSrc, DestHeight,
      // DestWidth, YDest, XDest, then the DIB.
      placed.push({
        rop: view.getUint32(at + 6, true),
        source: { height: word(3), width: word(4), y: word(5), x: word(6) },
        target: { height: word(7), width: word(8), y: word(9), x: word(10) },
        window,
        record: at,
        dib: at + 28,
        end: at + size,
      });
    } else if (fn === META_DIBSTRETCHBLT && size >= 26) {
      placed.push({
        rop: view.getUint32(at + 6, true),
        source: { height: word(2), width: word(3), y: word(4), x: word(5) },
        target: { height: word(6), width: word(7), y: word(8), x: word(9) },
        window,
        record: at,
        dib: at + 26,
        end: at + size,
      });
    } else if (fn === META_DIBBITBLT && size >= 22) {
      const target = { height: word(4), width: word(5), y: word(6), x: word(7) };
      placed.push({
        rop: view.getUint32(at + 6, true),
        source: { height: target.height, width: target.width, y: word(2), x: word(3) },
        target,
        window,
        record: at,
        dib: at + 22,
        end: at + size,
      });
    }
    at += size;
  }
  if (!placed.length) return null;
  const marked = bytes.slice();
  const out = new DataView(marked.buffer);
  placed.forEach(({ record }, index) => {
    // META_TEXTOUT: StringLength, the string padded to a word, YStart, XStart. The smallest
    // bitmap record has room for it, and the DIB after it is left as it was.
    const text = `${MARKER_PREFIX}${index}`;
    out.setUint16(record + 4, META_TEXTOUT, true);
    out.setInt16(record + 6, text.length, true);
    for (let char = 0; char < text.length; char += 1) {
      out.setUint8(record + 8 + char, text.charCodeAt(char));
    }
    const start = record + 8 + text.length + (text.length % 2);
    out.setInt16(start, 0, true);
    out.setInt16(start + 2, 0, true);
  });
  return { marked, placed };
}

/**
 * The scanned bitmaps as image commands in a canvas of `width` × `height` pixels, which
 * spans the metafile's window: one list per bitmap, empty for one that does not draw.
 */
export function wmfBitmapCommands(
  bytes: Uint8Array,
  placed: readonly PlacedBitmap[],
  width: number,
  height: number,
  budget: MetafileBudget
): MetafileCommand[][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const groups: MetafileCommand[][] = placed.map(() => []);
  for (const [index, { rop, source, target, window, dib, end }] of placed.entries()) {
    if (rop !== SRCCOPY && rop !== SRCAND && rop !== SRCPAINT) continue;
    if (window.width === 0 || window.height === 0) continue;
    const image = decodeDib(view, dib, end);
    if (!image) continue;
    const scaleX = width / window.width;
    const scaleY = height / window.height;
    const commands = groups[index]!;
    if (rop !== SRCCOPY) {
      const clear = rop === SRCAND ? 255 : 0;
      for (let pixel = 0; pixel < image.data.length; pixel += 4) {
        const data = image.data;
        if (data[pixel] === clear && data[pixel + 1] === clear && data[pixel + 2] === clear) {
          data[pixel + 3] = 0;
        }
      }
    }
    budget.pixels += image.width * image.height;
    if (budget.pixels > MAX_METAFILE_PIXELS) {
      budget.exhausted = true;
      break;
    }
    // The whole bitmap, scaled so its source rectangle fills the target rectangle.
    const sw = source.width || image.width;
    const sh = source.height || image.height;
    const pixelX = (target.width / sw) * scaleX;
    const pixelY = (target.height / sh) * scaleY;
    // Source rows count from the bottom of a bottom-up DIB and from the top of a top-down one.
    const sourceTop = image.topDown ? source.y : image.height - source.y - sh;
    const partial = source.x !== 0 || sourceTop !== 0 || sw !== image.width || sh !== image.height;
    if (partial) {
      const left = (target.x - window.x) * scaleX;
      const top = (target.y - window.y) * scaleY;
      const right = left + target.width * scaleX;
      const bottom = top + target.height * scaleY;
      commands.push(
        { kind: 'save' },
        {
          kind: 'clip',
          evenOdd: false,
          path: [
            { op: 'M', x: left, y: top },
            { op: 'L', x: right, y: top },
            { op: 'L', x: right, y: bottom },
            { op: 'L', x: left, y: bottom },
            { op: 'Z' },
          ],
        }
      );
    }
    commands.push({
      kind: 'image',
      raster: { kind: 'rgba', width: image.width, height: image.height, data: image.data },
      matrix: [
        image.width * pixelX,
        0,
        0,
        image.height * pixelY,
        (target.x - window.x) * scaleX - source.x * pixelX,
        (target.y - window.y) * scaleY - sourceTop * pixelY,
      ],
    });
    if (partial) commands.push({ kind: 'restore' });
  }
  return groups;
}

/**
 * The replayed commands with each bitmap's commands inserted where its marker was drawn.
 * `position` is the command index of a bitmap's marker, or -1 when the replayer stopped
 * before its record, in which case the bitmap is left out as the rest of the stream is.
 */
export function withWmfBitmaps(
  commands: readonly MetafileCommand[],
  groups: readonly (readonly MetafileCommand[])[],
  position: (index: number) => number
): readonly MetafileCommand[] {
  const out: MetafileCommand[] = [];
  let next = 0;
  groups.forEach((group, index) => {
    const at = position(index);
    if (at < 0 || !group.length) return;
    // Markers are drawn in record order, so their positions never go back.
    while (next < Math.min(at, commands.length)) out.push(commands[next++]!);
    for (const command of group) out.push(command);
  });
  while (next < commands.length) out.push(commands[next++]!);
  return out;
}
