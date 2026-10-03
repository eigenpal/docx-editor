import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { anchoredDrawingAtomsInParagraph } from './drawing-atom-walk.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import type { PendingLine } from './paragraph-flow.ts';

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

/** Whole breaks per pass and paragraph, so each continued page slices the same break. */
const wholeBreaks = new WeakMap<
  object,
  WeakMap<OoxmlNode, { readonly key: string; readonly lines: readonly PendingLine[] }>
>();

function passBreaks(
  pass: object
): WeakMap<OoxmlNode, { readonly key: string; readonly lines: readonly PendingLine[] }> {
  let byParagraph = wholeBreaks.get(pass);
  if (!byParagraph) {
    byParagraph = new WeakMap();
    wholeBreaks.set(pass, byParagraph);
  }
  return byParagraph;
}

/** Where a slice of the whole break may stand for a continued page's own break. */
export interface CellContinuationScope {
  /** One layout pass, which the held breaks live and die with. */
  readonly pass: object;
  readonly pageZones: boolean;
  readonly inlineDrawingLayout: InlineDrawingLayoutContext | undefined;
}

function sliceable(paragraph: OoxmlNode, scope: CellContinuationScope): boolean {
  return (
    !scope.pageZones &&
    (scope.inlineDrawingLayout === undefined ||
      !anchorsDrawing(paragraph, scope.inlineDrawingLayout))
  );
}

/** Hold a paragraph's whole break when its first page did not finish it. */
export function holdWholeCellBreak(
  paragraph: OoxmlNode,
  scope: CellContinuationScope,
  keyFrom: (offset: number) => string,
  lines: readonly PendingLine[]
): void {
  if (sliceable(paragraph, scope))
    passBreaks(scope.pass).set(paragraph, { key: keyFrom(0), lines });
}

/**
 * The lines of a cell paragraph from `startOffset`. A paragraph continued onto a later page is
 * the tail of its one whole break, so it slices that break instead of breaking the remainder
 * again on every page, which costs the whole remainder per page.
 *
 * The whole break holds only where a line's breaks do not depend on where the paragraph sits:
 * with no exclusion zones on the page and no anchored drawing of its own. Otherwise, and when
 * no later line of the whole break starts at `startOffset`, the remainder breaks on its own.
 * `keyFrom` names a break as the paragraph cache key does.
 */
export function continuedCellLines(
  paragraph: OoxmlNode,
  startOffset: number,
  scope: CellContinuationScope,
  keyFrom: (offset: number) => string,
  breakFrom: (offset: number) => readonly PendingLine[]
): readonly PendingLine[] {
  if (startOffset === 0 || !sliceable(paragraph, scope)) return breakFrom(startOffset);
  const byParagraph = passBreaks(scope.pass);
  const key = keyFrom(0);
  let whole = byParagraph.get(paragraph);
  if (whole?.key !== key) {
    whole = { key, lines: breakFrom(0) };
    byParagraph.set(paragraph, whole);
  }
  // Line 0 carries the first-line indent and list marker, which a continuation never has.
  for (let index = 1; index < whole.lines.length; index += 1) {
    const start = whole.lines[index]!.start;
    if (start === startOffset) return whole.lines.slice(index);
    if (start > startOffset) break;
  }
  return breakFrom(startOffset);
}
