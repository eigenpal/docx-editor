// Framework-neutral paint helpers shared by both adapters (comprehensive 4.6), so React and Vue
// interpret the contract display IR identically and neither re-derives geometry. Each adapter builds
// its own elements but reads styling decisions from here — colors, run typography, border-segment
// boxes — so a paint fix lands in one place for both.

import type { ColorValue, GlyphRun, BorderSeg, Rect } from '@docx-editor.dev/core-contract/geometry';

/** A ColorValue as a CSS color string, or undefined (inherit) for auto / theme slots the adapter
 *  cannot resolve. Hex values are '#'-prefixed — a bare 'RRGGBB' is NOT a valid CSS color. */
export function colorToCss(color: ColorValue): string | undefined {
  if (color.kind === 'hex') return `#${color.value.replace(/^#/, '')}`;
  return undefined; // 'auto' inherits; 'theme' needs a resolved palette (a later scope)
}

/** The resolved typography of a positioned text run (units left to the adapter). */
export interface RunStyle {
  readonly fontFamily: string;
  readonly fontSizePx: number;
  readonly color: string | undefined;
  readonly fontWeight: 'bold' | 'normal';
  readonly fontStyle: 'italic' | 'normal';
}

export function runStyle(run: GlyphRun): RunStyle {
  return {
    fontFamily: run.fontFamily,
    fontSizePx: run.fontSizePx,
    color: colorToCss(run.color),
    fontWeight: run.bold ? 'bold' : 'normal',
    fontStyle: run.italic ? 'italic' : 'normal',
  };
}

/** An axis-aligned border segment as a paintable 1px-thick box (min corner + extent). A backend
 *  paints it as a positioned filled rectangle. */
export function borderSegBox(seg: BorderSeg): Rect & { color: string | undefined } {
  const x = Math.min(seg.from.x, seg.to.x);
  const y = Math.min(seg.from.y, seg.to.y);
  const w = Math.abs(seg.to.x - seg.from.x) || seg.widthPx;
  const h = Math.abs(seg.to.y - seg.from.y) || seg.widthPx;
  return { x, y, width: w, height: h, color: colorToCss(seg.color) };
}
