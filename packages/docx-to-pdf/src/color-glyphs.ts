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
  readonly path: string;
}

/** Bounds on a file-derived color font: layers and outline points are both attacker-sized. */
const MAX_LAYERS = 256;
const MAX_COMMANDS = 8192;

/**
 * The COLR v0 layers of a glyph, or `null` when the face has none for it.
 *
 * A COLR/CPAL emoji font draws each emoji as a stack of monochrome glyphs, each filled with
 * a palette color. The PDF has no color glyph, so the text writer writes the glyph itself
 * invisibly, for extraction and search, and fills these layers where it would have drawn it.
 * Quadratic curves become cubics, because a PDF path has no quadratic operator.
 */
export function colorGlyphLayers(
  font: FontkitFont,
  glyphId: number,
  work: Work
): readonly ColorGlyphLayer[] | null {
  if (!font.COLR || !font.CPAL) return null;
  const layers = font.getGlyph(glyphId).layers;
  if (!layers || layers.length === 0 || layers.length > MAX_LAYERS) return null;
  const out: ColorGlyphLayer[] = [];
  for (const layer of layers) {
    work.tick();
    const path = pathOperators(layer.glyph.path.commands, work);
    if (path === null) return null;
    if (!path) continue;
    const { red, green, blue } = layer.color;
    out.push({
      fill: `${n(clampByte(red) / 255)} ${n(clampByte(green) / 255)} ${n(clampByte(blue) / 255)} rg`,
      path,
    });
  }
  return out;
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
    switch (command) {
      case 'moveTo':
        [x, y] = [args[0]!, args[1]!];
        out.push(`${n(x)} ${n(y)} m`);
        break;
      case 'lineTo':
        [x, y] = [args[0]!, args[1]!];
        out.push(`${n(x)} ${n(y)} l`);
        break;
      case 'quadraticCurveTo': {
        const [cx, cy, ex, ey] = [args[0]!, args[1]!, args[2]!, args[3]!];
        const c1x = x + (2 / 3) * (cx - x);
        const c1y = y + (2 / 3) * (cy - y);
        const c2x = ex + (2 / 3) * (cx - ex);
        const c2y = ey + (2 / 3) * (cy - ey);
        out.push(`${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(ex)} ${n(ey)} c`);
        [x, y] = [ex, ey];
        break;
      }
      case 'bezierCurveTo':
        out.push(args.slice(0, 6).map(n).join(' ') + ' c');
        [x, y] = [args[4]!, args[5]!];
        break;
      case 'closePath':
        out.push('h');
        break;
    }
  }
  return out.join(' ');
}
