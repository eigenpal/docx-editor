import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { anchoredDrawingAtomsInParagraph } from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { PendingLine } from './paragraph-flow.ts';

/**
 * Whole breaks of cell paragraphs that did not finish on their first page, held for one layout
 * pass. Each entry names its break by the paragraph cache key, so it is as exact as that cache.
 */
export type CellBreakMemo = WeakMap<
  OoxmlNode,
  { readonly key: string; readonly lines: readonly PendingLine[] }
>;

/** Where a held whole break may stand for a continued page's own break. */
export interface CellContinuationScope {
  /** The pass's memo; without one, every page breaks its own remainder. */
  readonly memo: CellBreakMemo | undefined;
  readonly pageZones: boolean;
  readonly inlineDrawingLayout: InlineDrawingLayoutContext | undefined;
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
 * A whole break holds for a later page only where line breaks do not depend on where the
 * paragraph sits: with no exclusion zones on the page and no anchored drawing of its own.
 */
function sliceable(paragraph: OoxmlNode, scope: CellContinuationScope): boolean {
  return (
    !scope.pageZones &&
    (scope.inlineDrawingLayout === undefined ||
      !anchorsDrawing(paragraph, scope.inlineDrawingLayout))
  );
}

/**
 * The lines a cell paragraph places from `startOffset`, and the index to place from. A page that
 * continues the paragraph after `priorLines` placed lines reuses the held whole break when its
 * line at that index starts at `startOffset`; breaking the remainder again on every page costs
 * the whole remainder per page. Line 0 is never a continuation: it owns the first-line indent
 * and the list marker. Any other case breaks the remainder on its own.
 */
export function continuedCellLines(
  paragraph: OoxmlNode,
  startOffset: number,
  priorLines: number,
  scope: CellContinuationScope,
  keyFrom: (offset: number) => string,
  breakRemainder: () => readonly PendingLine[]
): { readonly lines: readonly PendingLine[]; readonly from: number } {
  if (startOffset > 0 && priorLines > 0 && scope.memo) {
    const held = scope.memo.get(paragraph);
    if (
      held &&
      held.lines[priorLines]?.start === startOffset &&
      held.key === keyFrom(0) &&
      sliceable(paragraph, scope)
    )
      return { lines: held.lines, from: priorLines };
  }
  return { lines: breakRemainder(), from: 0 };
}

/**
 * Hold a whole break its first page did not finish, and release it once a continued page
 * finishes the paragraph, so the memo keeps only paragraphs still in flight.
 */
export function settleCellBreak(
  paragraph: OoxmlNode,
  startOffset: number,
  complete: boolean,
  scope: CellContinuationScope,
  keyFrom: (offset: number) => string,
  lines: readonly PendingLine[]
): void {
  if (!scope.memo) return;
  if (startOffset > 0) {
    if (complete) scope.memo.delete(paragraph);
  } else if (!complete && sliceable(paragraph, scope)) {
    scope.memo.set(paragraph, { key: keyFrom(0), lines });
  }
}
