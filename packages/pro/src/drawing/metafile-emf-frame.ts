/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An EMF picture is its header frame, not its ink bounds. Playback maps the frame onto the
// picture's box, so ink that starts inside the frame keeps its margin. The converter sizes the
// drawing to the bounds; this places that drawing in the frame.

import type { MetafileDrawing } from '@docx-editor.dev/core/store';

const EMR_HEADER = 1;
/** A frame further than this factor from the bounds is not trusted. */
const MAX_FRAME_RATIO = 4;

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The header's bounds in device pixels and frame converted to device pixels, or null. */
export function emfFrame(bytes: Uint8Array): { bounds: Rect; frame: Rect } | null {
  if (bytes.length < 88) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== EMR_HEADER || view.getUint32(40, true) !== 0x464d4520) {
    return null;
  }
  const rect = (at: number): Rect => ({
    left: view.getInt32(at, true),
    top: view.getInt32(at + 4, true),
    right: view.getInt32(at + 8, true),
    bottom: view.getInt32(at + 12, true),
  });
  const bounds = rect(8);
  const frameMm = rect(24);
  const devicePx = [view.getInt32(72, true), view.getInt32(76, true)] as const;
  const deviceMm = [view.getInt32(80, true), view.getInt32(84, true)] as const;
  if (!(devicePx[0] > 0 && devicePx[1] > 0 && deviceMm[0] > 0 && deviceMm[1] > 0)) return null;
  // The frame is in hundredths of a millimetre.
  const sx = devicePx[0] / deviceMm[0] / 100;
  const sy = devicePx[1] / deviceMm[1] / 100;
  const frame = {
    left: frameMm.left * sx,
    top: frameMm.top * sy,
    right: frameMm.right * sx,
    bottom: frameMm.bottom * sy,
  };
  return { bounds, frame };
}

/**
 * The drawing placed in its EMF frame: the frame's size, with the bounds-sized drawing offset
 * inside it. The drawing as it is when the header has no usable frame.
 */
export function inEmfFrame(bytes: Uint8Array, drawing: MetafileDrawing): MetafileDrawing {
  const header = emfFrame(bytes);
  if (!header) return drawing;
  const { bounds, frame } = header;
  const boundsWidth = bounds.right - bounds.left + 1;
  const boundsHeight = bounds.bottom - bounds.top + 1;
  const frameWidth = frame.right - frame.left;
  const frameHeight = frame.bottom - frame.top;
  if (!(boundsWidth > 0 && boundsHeight > 0 && frameWidth > 0 && frameHeight > 0)) return drawing;
  const ratio = Math.max(
    frameWidth / boundsWidth,
    boundsWidth / frameWidth,
    frameHeight / boundsHeight,
    boundsHeight / frameHeight
  );
  if (!(ratio <= MAX_FRAME_RATIO)) return drawing;
  // Converter pixels per device pixel.
  const sx = drawing.width / boundsWidth;
  const sy = drawing.height / boundsHeight;
  const dx = (bounds.left - frame.left) * sx;
  const dy = (bounds.top - frame.top) * sy;
  const width = frameWidth * sx;
  const height = frameHeight * sy;
  // The bounds count both edge pixels and the frame does not, so a frame that matches the
  // bounds is about one device pixel smaller.
  const same =
    Math.abs(dx) < 0.5 * sx &&
    Math.abs(dy) < 0.5 * sy &&
    Math.abs(width - drawing.width) <= 1.5 * sx &&
    Math.abs(height - drawing.height) <= 1.5 * sy;
  if (same) return drawing;
  return {
    width,
    height,
    commands: [{ kind: 'drawing', drawing, matrix: [1, 0, 0, 1, dx, dy] }],
  };
}
