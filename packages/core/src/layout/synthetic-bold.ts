import { trustedFontBytes, type ResolvedFont } from './font-resource.ts';
import { layoutRunHalfPointsOf } from './layout-run-shape.ts';
import { glyphSizeFactorOf, type ResolvedRunStyle } from './run-style.ts';
import { HEAD_TAG, OS2_TAG, tableDirectoryBase, tableOffset } from './sfnt-tables.ts';
import type { ShapedRun } from './shaped-run.ts';

/**
 * Extra advance of each inked glyph when bold is synthesized, as a fraction of the font size.
 *
 * A face without a bold style draws bold by thickening its outlines, and each glyph that has
 * ink then advances 1/50 em further. Blank glyphs such as spaces keep their advance. Measured
 * on Arabic text at 10, 20, 30, and 36 pt: the extra width matched this rule to the pixel.
 *
 * @public
 */
export const SYNTHETIC_BOLD_ADVANCE_EM = 1 / 50;

/**
 * Whether a face draws bold by itself: an `OS/2` weight class of 600 or more, or the bold bit
 * of `OS/2.fsSelection` or `head.macStyle`. A face without readable tables is not bold.
 *
 * The weight a face was REGISTERED under does not answer this. Word embeds the face it draws a
 * bold run with in the font's bold slot, and for a family without a bold face that is a copy of
 * the regular face, which Word then emboldens.
 */
export function sfntFaceIsBold(bytes: Uint8Array, faceIndex: number): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const base = tableDirectoryBase(view, bytes.byteLength, faceIndex);
  if (base === null) return false;
  // `usWeightClass` is at 4 and `fsSelection` at 62 in every OS/2 version; bit 5 is BOLD.
  const os2 = tableOffset(view, bytes.byteLength, base, OS2_TAG, 64);
  if (os2 !== null && (view.getUint16(os2 + 4) >= 600 || (view.getUint16(os2 + 62) & 0x20) !== 0))
    return true;
  // `macStyle` is at 44; bit 0 is bold.
  const head = tableOffset(view, bytes.byteLength, base, HEAD_TAG, 54);
  return head !== null && (view.getUint16(head + 44) & 0x01) !== 0;
}

const boldFaces = new WeakMap<ResolvedFont, boolean>();

/** Whether a bold run is drawn with a face that has no bold style. */
export function isSyntheticBold(style: ResolvedRunStyle, font: ResolvedFont): boolean {
  if (style.bold !== true) return false;
  let bold = boldFaces.get(font);
  if (bold === undefined) {
    bold = sfntFaceIsBold(trustedFontBytes(font), font.faceIndex);
    boldFaces.set(font, bold);
  }
  return !bold;
}

/**
 * Extra advance of each inked glyph of a synthesized-bold run, in points at the drawn size,
 * before horizontal scaling.
 */
export function syntheticBoldAdvancePt(style: ResolvedRunStyle): number {
  return (layoutRunHalfPointsOf(style) / 2) * glyphSizeFactorOf(style) * SYNTHETIC_BOLD_ADVANCE_EM;
}

/** Whether a shaped glyph draws ink and advances: the glyphs synthesized bold widens. */
function inked(glyph: ShapedRun['glyphs'][number]): boolean {
  return glyph.advanceX > 0 && glyph.outline.path.length > 0;
}

/** How many glyphs of a run synthesized bold widens. */
export function syntheticBoldGlyphCount(run: ShapedRun): number {
  let count = 0;
  for (const glyph of run.glyphs) if (inked(glyph)) count++;
  return count;
}

/**
 * Caret advances with the synthesized bold extra added: the advance at each UTF-16 offset
 * grows by `extraPt` for every widened glyph whose cluster starts before that offset.
 */
export function withSyntheticBoldCaretAdvances(
  advances: readonly number[],
  run: ShapedRun,
  extraPt: number
): readonly number[] {
  if (extraPt <= 0) return advances;
  const perOffset = new Array<number>(advances.length).fill(0);
  for (const glyph of run.glyphs) {
    if (!inked(glyph)) continue;
    const at = Math.min(Math.max(glyph.cluster + 1, 1), advances.length - 1);
    perOffset[at]! += extraPt;
  }
  let added = 0;
  return advances.map((advance, offset) => {
    added += perOffset[offset]!;
    return advance + added;
  });
}
