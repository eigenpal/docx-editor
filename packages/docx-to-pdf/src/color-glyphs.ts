/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import type { FontkitFont, FontkitGlyph, FontkitPathCommand } from 'fontkit';
import { ExportResourceError } from '@docx-editor.dev/core/export';
import { number as n, PdfWorkLimitError, Work } from './context.ts';

/** One palette layer of a color glyph, as PDF path operators in font units plus its fill. */
export interface ColorGlyphLayer {
  /** The fill operator, or null for a layer drawn in the text color (palette index 0xFFFF). */
  readonly fill: string | null;
  /** Constant alpha in [0, 1]; 1 for an opaque layer. */
  readonly alpha: number;
  readonly path: string;
}

/**
 * What a color face has for a glyph.
 *
 * - `layers`: the palette layers to fill, bottom first.
 * - `none`: the glyph has no COLR base glyph record. It is an ordinary monochrome glyph, such
 *   as a letter, a digit, or a space, and the writer writes it as text.
 * - `refused`: the layers exist but are outside this writer's bounds or malformed.
 */
export type ColorGlyph =
  | { readonly kind: 'layers'; readonly layers: readonly ColorGlyphLayer[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'refused'; readonly reason: string };

/** The palette index that a COLR layer uses for the text color. */
const FOREGROUND_PALETTE_INDEX = 0xffff;

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
 * would have drawn the glyph. A glyph with no base glyph record is an ordinary outline glyph,
 * which the writer writes as text. Quadratic curves become cubics, because a PDF path has no
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

/** The COLR v0 and CPAL records that this writer reads; fontkit does not type them. */
interface ColorTables {
  readonly COLR?: {
    readonly numLayerRecords?: number;
    readonly baseGlyphRecord?: readonly {
      readonly gid: number;
      readonly firstLayerIndex: number;
      readonly numLayers: number;
    }[];
    readonly layerRecords?: ArrayLike<{ readonly gid: number; readonly paletteIndex: number }>;
  };
  readonly CPAL?: {
    readonly numColorRecords?: number;
    readonly colorRecordIndices?: readonly number[];
    readonly colorRecords?: ArrayLike<{
      readonly red: number;
      readonly green: number;
      readonly blue: number;
      readonly alpha: number;
    }>;
  };
}

type BaseRecord = NonNullable<NonNullable<ColorTables['COLR']>['baseGlyphRecord']>[number];

const baseRecords = new WeakMap<FontkitFont, Map<number, BaseRecord>>();

/** The COLR base glyph record of each glyph id, built once per face. The first record wins. */
function baseRecord(font: FontkitFont, glyphId: number): BaseRecord | undefined {
  let byGlyph = baseRecords.get(font);
  if (!byGlyph) {
    byGlyph = new Map();
    for (const record of (font as unknown as ColorTables).COLR?.baseGlyphRecord ?? [])
      if (!byGlyph.has(record.gid)) byGlyph.set(record.gid, record);
    baseRecords.set(font, byGlyph);
  }
  return byGlyph.get(glyphId);
}

/** fontkit's table directory, which it does not type. */
interface FaceInternals {
  readonly directory?: { readonly tables?: Readonly<Record<string, unknown>> };
}

const outlineFaces = new WeakMap<FontkitFont, FontkitFont>();

/**
 * A view of a color face that reads only outlines.
 *
 * fontkit keeps one glyph cache per face, and `getGlyph` on a COLR/CPAL face stores a color
 * wrapper whose own path is empty. Its outline lookup (`_getBaseGlyph`) and its composite
 * expansion (`getGlyph` for each component) both read that cache. So a monochrome glyph, an
 * accented letter built from components, or a layer glyph already looked up painted nothing.
 * The view shares the face's bytes and tables but has its own glyph cache and a directory
 * without the color tables, so every lookup through it returns the `glyf` or CFF glyph.
 */
export function outlineFace(font: FontkitFont): FontkitFont {
  let face = outlineFaces.get(font);
  if (face) return face;
  const directory = (font as unknown as FaceInternals).directory;
  if (!directory?.tables || !(directory.tables.COLR || directory.tables.CPAL)) {
    face = font;
  } else {
    const { COLR: _colr, CPAL: _cpal, ...tables } = directory.tables;
    face = Object.create(font, {
      directory: { value: { ...directory, tables } },
      _glyphs: { value: {}, writable: true },
      _glyphsByCharacters: { value: {}, writable: true },
    }) as FontkitFont;
  }
  outlineFaces.set(font, face);
  return face;
}

/** A glyph's outline as PDF path operators in font units, from the face's outline view. */
function outlinePath(font: FontkitFont, glyphId: number, work: Work): string | null {
  const face = outlineFace(font);
  const commands = boundedPathCommands(face, face.getGlyph(glyphId));
  return commands && pathOperators(commands, work);
}

function readColorGlyph(font: FontkitFont, glyphId: number, work: Work): ColorGlyph {
  const tables = font as unknown as ColorTables;
  const record = tables.COLR && tables.CPAL ? baseRecord(font, glyphId) : undefined;
  // A glyph without a base glyph record is an ordinary outline glyph (OpenType COLR v0).
  if (!record) return { kind: 'none' };
  const { firstLayerIndex, numLayers } = record;
  if (numLayers > MAX_LAYERS)
    return { kind: 'refused', reason: `${numLayers} layers exceed the ${MAX_LAYERS} allowed` };
  const layerRecords = tables.COLR!.layerRecords;
  const layerCount = Math.min(tables.COLR!.numLayerRecords ?? 0, layerRecords?.length ?? 0);
  if (!layerRecords || firstLayerIndex + numLayers > layerCount)
    return { kind: 'refused', reason: 'the layer records are out of range' };
  const palette = tables.CPAL!;
  const paletteStart = palette.colorRecordIndices?.[0] ?? 0;
  const colorCount = Math.min(palette.numColorRecords ?? 0, palette.colorRecords?.length ?? 0);
  const out: ColorGlyphLayer[] = [];
  for (let index = firstLayerIndex; index < firstLayerIndex + numLayers; index++) {
    work.tick();
    const layer = layerRecords[index]!;
    const path = outlinePath(font, layer.gid, work);
    if (path === null)
      return { kind: 'refused', reason: 'a layer outline is malformed or too long' };
    if (!path) continue;
    if (layer.paletteIndex === FOREGROUND_PALETTE_INDEX) {
      out.push({ fill: null, alpha: 1, path });
      continue;
    }
    // Palette 0 is the default palette; its entries start at its first color record index.
    const colorIndex = paletteStart + layer.paletteIndex;
    if (colorIndex >= colorCount)
      return { kind: 'refused', reason: 'a layer names a palette entry that does not exist' };
    const { red, green, blue, alpha } = palette.colorRecords![colorIndex]!;
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
  const path = outlinePath(font, glyphId, work);
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
