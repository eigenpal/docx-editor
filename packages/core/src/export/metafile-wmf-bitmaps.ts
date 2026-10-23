// Device-independent bitmaps in a WMF, which the metafile replayer does not draw: each
// `META_STRETCHDIB`, `META_DIBSTRETCHBLT` and `META_DIBBITBLT`, decoded and placed in the
// replayed canvas. A copy (SRCCOPY) paints every pixel. A mask that combines with the page
// (SRCAND, SRCPAINT) paints the pixels that change a white page or a black one, and leaves
// the rest clear, as it shows over a plain page.
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

/** A DIB (`BITMAPINFOHEADER` or `BITMAPCOREHEADER` and its bits) as RGBA, or null. */
export function decodeDib(
  view: DataView,
  start: number,
  end: number
): { width: number; height: number; data: Uint8Array } | null {
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
  return { width, height: rows, data };
}

/**
 * The bitmaps of a WMF as image commands in a canvas of `width` × `height` pixels,
 * which spans the metafile's window. Empty for an EMF or a WMF with none.
 */
export function wmfBitmapCommands(
  bytes: Uint8Array,
  width: number,
  height: number,
  budget: MetafileBudget
): MetafileCommand[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22) return [];
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
  if (at + 18 > bytes.length) return [];
  at += view.getUint16(at + 2, true) * 2;
  const placed: { rop: number; source: Placement; target: Placement; dib: number; end: number }[] =
    [];
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
        dib: at + 28,
        end: at + size,
      });
    } else if (fn === META_DIBSTRETCHBLT && size >= 26) {
      placed.push({
        rop: view.getUint32(at + 6, true),
        source: { height: word(2), width: word(3), y: word(4), x: word(5) },
        target: { height: word(6), width: word(7), y: word(8), x: word(9) },
        dib: at + 26,
        end: at + size,
      });
    } else if (fn === META_DIBBITBLT && size >= 22) {
      const target = { height: word(4), width: word(5), y: word(6), x: word(7) };
      placed.push({
        rop: view.getUint32(at + 6, true),
        source: { height: target.height, width: target.width, y: word(2), x: word(3) },
        target,
        dib: at + 22,
        end: at + size,
      });
    }
    at += size;
  }
  if (!placed.length || window.width === 0 || window.height === 0) return [];
  const scaleX = width / window.width;
  const scaleY = height / window.height;
  const commands: MetafileCommand[] = [];
  for (const { rop, source, target, dib, end } of placed) {
    if (rop !== SRCCOPY && rop !== SRCAND && rop !== SRCPAINT) continue;
    const image = decodeDib(view, dib, end);
    if (!image) continue;
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
    // DIB source rows count from the bottom.
    const sourceTop = image.height - source.y - sh;
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
  return commands;
}
