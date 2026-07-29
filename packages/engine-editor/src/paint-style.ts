// Framework-neutral paint helpers shared by both adapters (comprehensive 4.6), so React and Vue
// interpret the contract display IR identically and neither re-derives geometry. Each adapter builds
// its own elements but reads styling decisions from here — colors, run typography, border-segment
// boxes — so a paint fix lands in one place for both.

import type { ColorValue, GlyphRun, BorderSeg } from '@docx-editor.dev/core-contract/contracts/geometry';

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
  readonly fontWeight: number;
  readonly fontStyle: 'italic' | 'normal';
  readonly direction: 'ltr' | 'rtl';
  readonly widthPx: number;
  readonly heightPx: number;
  readonly fontFeatureSettings: string | undefined;
  /** CSS text-decoration (underline / line-through / both), or undefined for none. */
  readonly textDecoration: string | undefined;
}

export function runStyle(run: GlyphRun, installedFontAlias: string): RunStyle {
  const decos: string[] = [];
  if (run.underline) decos.push('underline');
  if (run.strike) decos.push('line-through');
  return {
    fontFamily: installedFontAlias,
    fontSizePx: run.fontSizePx,
    color: colorToCss(run.color),
    fontWeight: run.fontWeight,
    fontStyle: run.fontStyle,
    direction: run.direction,
    widthPx: run.box.width,
    heightPx: run.box.height,
    fontFeatureSettings:
      (run.shaping.features ?? [])
        .filter(([tag, value]) => /^[A-Za-z0-9]{4}$/.test(tag) && Number.isFinite(value))
        .map(([tag, value]) => `"${tag}" ${value}`)
        .join(', ') || undefined,
    textDecoration: decos.length ? decos.join(' ') : undefined,
  };
}

/** A border segment as a paintable line: min corner, orientation, length, thickness, and the CSS
 *  border-style honoring `BorderSeg.style` (so double/dotted/dashed do not degrade to solid). */
export interface BorderLine {
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly horizontal: boolean;
  readonly widthPx: number;
  readonly color: string | undefined;
  readonly cssStyle: 'solid' | 'double' | 'dotted' | 'dashed';
}

export function borderSegLine(seg: BorderSeg): BorderLine {
  const dx = Math.abs(seg.to.x - seg.from.x);
  const dy = Math.abs(seg.to.y - seg.from.y);
  const horizontal = dx >= dy;
  return {
    x: Math.min(seg.from.x, seg.to.x),
    y: Math.min(seg.from.y, seg.to.y),
    length: horizontal ? dx : dy,
    horizontal,
    widthPx: seg.widthPx,
    color: colorToCss(seg.color),
    cssStyle: seg.style === 'single' ? 'solid' : seg.style,
  };
}
