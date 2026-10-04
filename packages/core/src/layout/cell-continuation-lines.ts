import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import { anchorsAnyDrawing } from './drawing-placement-exclusion.ts';
import { crossesContent } from './narrow-wrap-clearance.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { PendingLine } from './paragraph-flow.ts';

/**
 * A cell paragraph's line break carried on its cell cursor to the page that continues it.
 * `lines[0]` is the paragraph's line `base`, and `key` names every input of the break except
 * where the paragraph sits.
 */
export interface HeldCellBreak {
  readonly key: string;
  readonly lines: readonly PendingLine[];
  readonly base: number;
}

/**
 * The page's exclusion zones that can reach a cell paragraph's lines: those that reach below
 * its top over the cell, and any the paragraph anchors itself. A band above the paragraph, such
 * as a header logo's, wraps nothing it holds; nor does a band beside the cell, whichever side
 * it lets text pass on: the cell clips its wrap intervals to its own content box.
 */
export function zonesReachingCellParagraph(
  zones: readonly ExclusionZone[],
  paragraphId: string,
  top: number,
  cellWidth: number
): readonly ExclusionZone[] {
  const reaches = (zone: ExclusionZone): boolean =>
    zone.anchorParagraphId === paragraphId ||
    (zone.verticalBand.y + zone.verticalBand.height > top - 0.001 &&
      crossesContent(zone, 0, cellWidth));
  return zones.every(reaches) ? zones : zones.filter(reaches);
}

/**
 * The lines a cell paragraph places on this page. A page that continues the paragraph after
 * `continuedAfter` placed lines indexes the break its cursor carries, when that break still
 * holds here and its line at that index starts at `startOffset`; breaking the remainder again
 * on every page costs the whole remainder per page. Any other page breaks its own remainder.
 *
 * A break holds on any page where the paragraph's lines are independent of where it sits: no
 * zone reaches it (`zones` are the reaching ones) and it anchors no drawing of its own.
 *
 * `lineStart` indexes `lines`; `priorLineCount + lineStart` is the paragraph line index, which
 * line ids and the returned cursor count in. `carry` gives the break the next page receives.
 */
export function cellParagraphLines(input: {
  readonly paragraph: OoxmlElement;
  readonly startOffset: number;
  /** Lines already placed, for a model-offset continuation; undefined otherwise. */
  readonly continuedAfter: number | undefined;
  /** The legacy line-index cursor, which breaks the whole paragraph and slices it. */
  readonly legacyLineStart: number;
  readonly held: HeldCellBreak | undefined;
  /** The page's zones that reach this paragraph; see {@link zonesReachingCellParagraph}. */
  readonly zones: readonly ExclusionZone[];
  readonly inlineDrawingLayout: InlineDrawingLayoutContext | undefined;
  readonly heldKey: () => string;
  readonly breakRemainder: () => readonly PendingLine[];
}): {
  readonly lines: readonly PendingLine[];
  readonly lineStart: number;
  readonly priorLineCount: number;
  readonly carry: () => HeldCellBreak | undefined;
} {
  // Asked only when a page checks or carries a break; most cell paragraphs finish in place.
  const free = (): boolean =>
    input.zones.length === 0 && !anchorsAnyDrawing(input.paragraph, input.inlineDrawingLayout);
  const { held, continuedAfter } = input;
  if (held && continuedAfter !== undefined && held.key === input.heldKey() && free()) {
    // Index 0 of a whole break owns the first-line indent and list marker; never a continuation.
    const index = continuedAfter - held.base;
    if (index > 0 && held.lines[index]?.start === input.startOffset) {
      return { lines: held.lines, lineStart: index, priorLineCount: held.base, carry: () => held };
    }
  }
  const lines = input.breakRemainder();
  const base = continuedAfter ?? 0;
  return {
    lines,
    lineStart: continuedAfter !== undefined ? 0 : input.legacyLineStart,
    priorLineCount: base,
    carry: () => (free() ? { key: input.heldKey(), lines, base } : undefined),
  };
}
