/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { FontkitFont, FontkitPathCommand } from 'fontkit';
import { number as n, Work } from './context.ts';

/** One palette layer of a color glyph, as PDF path operators in font units plus its fill. */
export interface ColorGlyphLayer {
  readonly fill: string;
  /** Constant alpha in [0, 1]; 1 for an opaque layer. */
  readonly alpha: number;
  readonly path: string;
}

/**
 * What a color face has for a glyph.
 *
 * - `layers`: the palette layers to fill, bottom first.
 * - `none`: the glyph has no color layers. `outlined` says whether it has an outline of its
 *   own; a space has none and paints nothing, a monochrome glyph does and cannot be drawn
 *   from a face this writer does not embed.
 * - `refused`: the layers exist but are outside this writer's bounds or malformed.
 */
export type ColorGlyph =
  | { readonly kind: 'layers'; readonly layers: readonly ColorGlyphLayer[] }
  | { readonly kind: 'none'; readonly outlined: boolean }
  | { readonly kind: 'refused'; readonly reason: string };

/** Bounds on a file-derived color font: layers and outline points are both attacker-sized. */
const MAX_LAYERS = 256;
const MAX_COMMANDS = 8192;

const cache = new WeakMap<FontkitFont, Map<number, ColorGlyph>>();

/**
 * The COLR v0 layers of a glyph.
 *
 * A COLR/CPAL emoji font draws each emoji as a stack of monochrome glyphs, each filled with
 * a palette color. The PDF has no color glyph, so the text writer fills these layers where it
 * would have drawn the glyph. Quadratic curves become cubics, because a PDF path has no
 * quadratic operator. Every operator string is charged to the content budget as it is built,
 * so a hostile face cannot assemble more than the writer would let it emit.
 */
export function colorGlyph(font: FontkitFont, glyphId: number, work: Work): ColorGlyph {
  let byGlyph = cache.get(font);
  if (!byGlyph) {
    byGlyph = new Map();
    cache.set(font, byGlyph);
  }
  const known = byGlyph.get(glyphId);
  if (known) return known;
  const result = readColorGlyph(font, glyphId, work);
  byGlyph.set(glyphId, result);
  return result;
}

function readColorGlyph(font: FontkitFont, glyphId: number, work: Work): ColorGlyph {
  const glyph = font.getGlyph(glyphId);
  const layers = glyph.layers;
  if (!layers || layers.length === 0)
    return { kind: 'none', outlined: glyph.path.commands.length > 0 };
  if (layers.length > MAX_LAYERS)
    return { kind: 'refused', reason: `${layers.length} layers exceed the ${MAX_LAYERS} allowed` };
  const out: ColorGlyphLayer[] = [];
  for (const layer of layers) {
    work.tick();
    const path = pathOperators(layer.glyph.path.commands, work);
    if (path === null)
      return { kind: 'refused', reason: 'a layer outline is malformed or too long' };
    if (!path) continue;
    const { red, green, blue, alpha } = layer.color;
    out.push({
      fill: `${n(clampByte(red) / 255)} ${n(clampByte(green) / 255)} ${n(clampByte(blue) / 255)} rg`,
      alpha: clampByte(alpha) / 255,
      path,
    });
  }
  return { kind: 'layers', layers: out };
}

function clampByte(value: number): number {
  return Number.isFinite(value) ? Math.min(255, Math.max(0, Math.round(value))) : 0;
}

function pathOperators(commands: readonly FontkitPathCommand[], work: Work): string | null {
  if (commands.length > MAX_COMMANDS) return null;
  const out: string[] = [];
  let x = 0;
  let y = 0;
  for (const { command, args } of commands) {
    work.tick();
    if (args.some((value) => !Number.isFinite(value))) return null;
    let operator: string;
    switch (command) {
      case 'moveTo':
        [x, y] = [args[0]!, args[1]!];
        operator = `${n(x)} ${n(y)} m`;
        break;
      case 'lineTo':
        [x, y] = [args[0]!, args[1]!];
        operator = `${n(x)} ${n(y)} l`;
        break;
      case 'quadraticCurveTo': {
        const [cx, cy, ex, ey] = [args[0]!, args[1]!, args[2]!, args[3]!];
        const c1x = x + (2 / 3) * (cx - x);
        const c1y = y + (2 / 3) * (cy - y);
        const c2x = ex + (2 / 3) * (cx - ex);
        const c2y = ey + (2 / 3) * (cy - ey);
        operator = `${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(ex)} ${n(ey)} c`;
        [x, y] = [ex, ey];
        break;
      }
      case 'bezierCurveTo':
        operator = args.slice(0, 6).map(n).join(' ') + ' c';
        [x, y] = [args[4]!, args[5]!];
        break;
      case 'closePath':
        operator = 'h';
        break;
      default:
        return null;
    }
    work.reserveContent(operator.length + 1);
    out.push(operator);
  }
  return out.join(' ');
}
