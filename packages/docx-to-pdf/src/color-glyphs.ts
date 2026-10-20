/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { FontkitFont, FontkitGlyph, FontkitPathCommand } from 'fontkit';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import { number as n, PdfWorkLimitError, Work } from './context.ts';

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
/** Composite nesting and expanded points a glyph may reach before fontkit builds its path. */
const MAX_COMPOSITE_DEPTH = 8;
const MAX_EXPANDED_POINTS = MAX_COMMANDS;

/** A decoded TrueType glyph as fontkit's `_decode` returns it; fontkit does not type it. */
interface DecodedGlyph {
  readonly points?: readonly unknown[];
  readonly components?: readonly { readonly glyphID: number }[];
}

const pathSafety = new WeakMap<object, boolean>();

/**
 * Whether fontkit may build this glyph's path.
 *
 * fontkit expands a TrueType composite by recursing through its components with no depth
 * limit and no cache, and it counts nothing until the whole path exists. A composite that
 * names itself overflows the stack; a chain whose components each name the next glyph twice
 * doubles the work per level, and depth 18 blocked the event loop for 110 seconds. The
 * export deadline cannot interrupt inside fontkit, so the tree is measured first: every
 * glyph's expanded point count once, with the nesting, cycles and total bounded. Keyed by
 * glyph object, which fontkit caches per id.
 */
function pathIsSafe(font: FontkitFont, glyph: FontkitGlyph): boolean {
  const cached = pathSafety.get(glyph);
  if (cached !== undefined) return cached;
  let safe: boolean;
  try {
    const { points, height } = expanded(font, glyph, 0, new Map(), new Set());
    safe = points <= MAX_EXPANDED_POINTS && height <= MAX_COMPOSITE_DEPTH;
  } catch {
    safe = false;
  }
  pathSafety.set(glyph, safe);
  return safe;
}

/**
 * The points a glyph expands to and the nesting below it, or Infinity past a bound. Memoized
 * per glyph within one walk, so a shared component is decoded once; the height travels with
 * it, so a subtree first met near the top still counts its full depth lower down.
 */
function expanded(
  font: FontkitFont,
  glyph: FontkitGlyph,
  depth: number,
  memo: Map<object, { points: number; height: number }>,
  open: Set<object>
): { points: number; height: number } {
  const cached = memo.get(glyph);
  if (cached) return cached;
  if (depth > MAX_COMPOSITE_DEPTH || open.has(glyph)) return { points: Infinity, height: Infinity };
  const decode = (glyph as unknown as { _decode?: () => DecodedGlyph | null })._decode;
  // Only `glyf` faces nest glyphs; a CFF glyph has no components.
  if (typeof decode !== 'function') return { points: 0, height: 0 };
  const decoded = decode.call(glyph);
  // Every visit costs at least one, so a fan-out of empty leaves (fontkit decodes each
  // occurrence again) cannot hide exponential work behind a zero point count.
  let points = (decoded?.points?.length ?? 0) + 1;
  let height = 0;
  open.add(glyph);
  for (const component of decoded?.components ?? []) {
    const child = expanded(font, font.getGlyph(component.glyphID), depth + 1, memo, open);
    points += child.points;
    height = Math.max(height, child.height + 1);
    if (points > MAX_EXPANDED_POINTS || height > MAX_COMPOSITE_DEPTH) break;
  }
  open.delete(glyph);
  const result = { points, height };
  memo.set(glyph, result);
  return result;
}

/** A glyph's path commands, or null when the glyph is unsafe to expand or fontkit fails. */
function boundedPathCommands(
  font: FontkitFont,
  glyph: FontkitGlyph
): readonly FontkitPathCommand[] | null {
  if (!pathIsSafe(font, glyph)) return null;
  try {
    return glyph.path.commands;
  } catch {
    return null;
  }
}

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
  let result: ColorGlyph;
  try {
    result = readColorGlyph(font, glyphId, work);
  } catch (error) {
    // A malformed color table is refused for this glyph, never for the whole export. The
    // work budget's own errors still end the export.
    if (error instanceof PdfWorkLimitError || error instanceof ExportResourceError) throw error;
    result = { kind: 'refused', reason: 'the color glyph could not be read' };
  }
  byGlyph.set(glyphId, result);
  return result;
}

function readColorGlyph(font: FontkitFont, glyphId: number, work: Work): ColorGlyph {
  const glyph = font.getGlyph(glyphId);
  const layers = glyph.layers;
  if (!layers || layers.length === 0) {
    // An outline too deep or too large to expand counts as one, so the writer reports it.
    const commands = boundedPathCommands(font, glyph);
    return { kind: 'none', outlined: commands === null || commands.length > 0 };
  }
  if (layers.length > MAX_LAYERS)
    return { kind: 'refused', reason: `${layers.length} layers exceed the ${MAX_LAYERS} allowed` };
  const out: ColorGlyphLayer[] = [];
  for (const layer of layers) {
    work.tick();
    const commands = boundedPathCommands(font, layer.glyph);
    const path = commands && pathOperators(commands, work);
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

const outlines = new WeakMap<FontkitFont, Map<number, string | null>>();

/**
 * One glyph's monochrome outline as PDF path operators in font units, or null when it is
 * malformed or over the bound. `''` for a glyph with no outline. Memoized per face.
 */
export function glyphOutline(font: FontkitFont, glyphId: number, work: Work): string | null {
  let byGlyph = outlines.get(font);
  if (!byGlyph) {
    byGlyph = new Map();
    outlines.set(font, byGlyph);
  }
  if (byGlyph.has(glyphId)) return byGlyph.get(glyphId)!;
  const commands = boundedPathCommands(font, font.getGlyph(glyphId));
  const path = commands && pathOperators(commands, work);
  byGlyph.set(glyphId, path);
  return path;
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
