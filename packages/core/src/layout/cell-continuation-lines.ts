import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { anchoredDrawingAtomsInParagraph } from './drawing-atom-walk.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
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

/** Per drawing context: whether a paragraph anchors a drawing. Nodes are immutable per revision. */
const anchorsByContext = new WeakMap<InlineDrawingLayoutContext, WeakMap<OoxmlNode, boolean>>();

function anchorsDrawing(paragraph: OoxmlNode, context: InlineDrawingLayoutContext): boolean {
  let byParagraph = anchorsByContext.get(context);
  if (!byParagraph) {
    byParagraph = new WeakMap();
    anchorsByContext.set(context, byParagraph);
  }
  let anchors = byParagraph.get(paragraph);
  if (anchors === undefined) {
    anchors = anchoredDrawingAtomsInParagraph(paragraph, context).length > 0;
    byParagraph.set(paragraph, anchors);
  }
  return anchors;
}

/**
 * Whether the paragraph's line breaks on this page are independent of where it sits: no
 * exclusion band reaches below its top, and it anchors no drawing of its own. A band above it,
 * such as a header logo's, wraps nothing it holds.
 */
function positionFree(
  paragraph: OoxmlNode,
  top: number,
  zones: readonly ExclusionZone[],
  inlineDrawingLayout: InlineDrawingLayoutContext | undefined
): boolean {
  for (const zone of zones)
    if (zone.verticalBand.y + zone.verticalBand.height > top - 0.001) return false;
  return inlineDrawingLayout === undefined || !anchorsDrawing(paragraph, inlineDrawingLayout);
}

/**
 * The lines a cell paragraph places on this page. A page that continues the paragraph after
 * `continuedAfter` placed lines indexes the break its cursor carries, when that break still
 * holds here and its line at that index starts at `startOffset`; breaking the remainder again
 * on every page costs the whole remainder per page. Any other page breaks its own remainder.
 *
 * `lineStart` indexes `lines`; `priorLineCount + lineStart` is the paragraph line index, which
 * line ids and the returned cursor count in. `carry` gives the break the next page receives.
 */
export function cellParagraphLines(input: {
  readonly paragraph: OoxmlNode;
  readonly startOffset: number;
  /** Lines already placed, for a model-offset continuation; undefined otherwise. */
  readonly continuedAfter: number | undefined;
  /** The legacy line-index cursor, which breaks the whole paragraph and slices it. */
  readonly legacyLineStart: number;
  readonly held: HeldCellBreak | undefined;
  readonly top: number;
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
  const free = positionFree(input.paragraph, input.top, input.zones, input.inlineDrawingLayout);
  const key = free ? input.heldKey() : '';
  const { held, continuedAfter } = input;
  if (free && held && continuedAfter !== undefined && held.key === key) {
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
    carry: () => (free ? { key, lines, base } : undefined),
  };
}
