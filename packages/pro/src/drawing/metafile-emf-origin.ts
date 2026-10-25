/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An EMF that sets its own window and viewport extents maps logical units to device pixels.
// The picture is the header bounds of that device space, so the canvas starts at the bounds
// origin and scales device pixels to canvas pixels. `emf-converter` draws such a stream in
// device pixels from the canvas corner, which moves a picture whose bounds do not start at 0
// off its own canvas. This rewrites the viewport records so the device-to-canvas step is part
// of the stream's own mapping, and leaves every other stream as it is.

const SET_WINDOW_EXT = 9;
const SET_WINDOW_ORG = 10;
const SET_VIEWPORT_EXT = 11;
const SET_VIEWPORT_ORG = 12;
const MAX_SCALE = 4;

/** How the replayer sizes its canvas; the same rules as its own canvas setup. */
export interface EmfCanvasOptions {
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly dpiScale?: number;
  readonly maxCanvasDimension?: number;
}

function canvasScale(
  width: number,
  height: number,
  options: EmfCanvasOptions
): { x: number; y: number } {
  const scale = Math.max(1, Math.min(options.dpiScale ?? 1, MAX_SCALE));
  let w = Math.round(width * scale);
  let h = Math.round(height * scale);
  if (options.maxWidth && w > options.maxWidth) {
    h = Math.round(h * (options.maxWidth / w));
    w = options.maxWidth;
  }
  if (options.maxHeight && h > options.maxHeight) {
    w = Math.round(w * (options.maxHeight / h));
    h = options.maxHeight;
  }
  const cap = Math.max(1, Math.floor(options.maxCanvasDimension ?? Infinity));
  w = Math.max(1, Math.min(w, cap));
  h = Math.max(1, Math.min(h, cap));
  return { x: w / width, y: h / height };
}

function orgRecord(type: number, x: number, y: number): Uint8Array {
  const record = new Uint8Array(16);
  const view = new DataView(record.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, 16, true);
  view.setInt32(8, x, true);
  view.setInt32(12, y, true);
  return record;
}

/**
 * The EMF with its bounds origin and canvas scale folded into its viewport records, or the
 * same bytes when the stream does not set both a window and a viewport extent.
 */
export function emfWithCanvasMapping(bytes: Uint8Array, options: EmfCanvasOptions): Uint8Array {
  if (bytes.length < 88) return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = view.getUint32(4, true);
  if (headerSize < 88 || headerSize > bytes.length) return bytes;
  const left = view.getInt32(8, true);
  const top = view.getInt32(12, true);
  const width = view.getInt32(16, true) - left;
  const height = view.getInt32(20, true) - top;
  if (!(width > 0 && height > 0)) return bytes;
  const seen = new Set<number>();
  for (let at = headerSize; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    if (size < 8 || at + size > bytes.length) break;
    seen.add(view.getUint32(at, true));
    at += size;
  }
  if (!seen.has(SET_WINDOW_EXT) || !seen.has(SET_VIEWPORT_EXT)) return bytes;

  const scale = canvasScale(width, height, options);
  const out = new Uint8Array(bytes.length + 32);
  out.set(bytes.subarray(0, headerSize));
  // Mapping defaults, before the stream's own records: window origin 0, and a viewport
  // origin that puts the bounds corner at the canvas corner.
  out.set(orgRecord(SET_WINDOW_ORG, 0, 0), headerSize);
  out.set(
    orgRecord(SET_VIEWPORT_ORG, Math.round(-left * scale.x), Math.round(-top * scale.y)),
    headerSize + 16
  );
  out.set(bytes.subarray(headerSize), headerSize + 32);
  const written = new DataView(out.buffer);
  written.setUint32(48, out.length, true);
  written.setUint32(52, view.getUint32(52, true) + 2, true);
  for (let at = headerSize + 32; at + 8 <= out.length; ) {
    const type = written.getUint32(at, true);
    const size = written.getUint32(at + 4, true);
    if (size < 8 || at + size > out.length) break;
    if (size >= 16 && type === SET_VIEWPORT_EXT) {
      written.setInt32(at + 8, Math.round(written.getInt32(at + 8, true) * scale.x), true);
      written.setInt32(at + 12, Math.round(written.getInt32(at + 12, true) * scale.y), true);
    } else if (size >= 16 && type === SET_VIEWPORT_ORG) {
      const x = written.getInt32(at + 8, true);
      const y = written.getInt32(at + 12, true);
      written.setInt32(at + 8, Math.round((x - left) * scale.x), true);
      written.setInt32(at + 12, Math.round((y - top) * scale.y), true);
    }
    at += size;
  }
  return out;
}
