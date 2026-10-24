// The anchored objects of a cell-flow paragraph: their publication, and the room they claim.
//
// A wrapping object laid out in a table cell and positioned from its paragraph stays inside
// its cell: a negative offset stops at the cell box top (`anchor-content-top.ts`), and the
// cell grows until it holds the whole object, so the next row starts below it. The text
// after it in the same cell still wraps around it, so only the cell's bottom moves, never
// the paragraph's. An object that does not wrap (`wrapNone`, in front of or behind the
// text) keeps its offset and claims no room.

import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import { wrapsText } from './anchor-content-top.ts';
import {
  anchorLaidOutInCell,
  cellAnchorScope,
  type CellAnchorScope,
} from './cell-anchor-layout.ts';
import { anchoredDrawingAtomsInParagraph } from './drawing-atom-walk.ts';
import {
  emuToPointsSafe,
  measureInlineDrawing,
  publishAnchoredDrawingsForParagraph,
} from './drawing-layout.ts';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import type { BlockFragmentRecord, LayoutBox, LineRecord } from './semantic-records.ts';
import type { TableFlowDeps } from './semantic-table-layout.ts';

/** Publish (or defer to the row) the anchored objects of one placed cell paragraph. */
export function publishCellParagraphAnchors(
  deps: TableFlowDeps,
  placed: {
    readonly paragraph: OoxmlNode;
    readonly paragraphId: string;
    readonly paragraphBox: LayoutBox;
    readonly lines: readonly LineRecord[];
    readonly originX: number;
    readonly top: number;
    readonly maxBottom: number;
    readonly cellContentWidth: number;
    readonly anchorScope: CellAnchorScope;
  }
): void {
  if (!deps.inlineDrawingLayout || !deps.anchorFrameBase || !deps.pageContentClip) return;
  const { paragraph, paragraphId, paragraphBox, lines } = placed;
  if (deps.deferAnchoredDrawings) {
    deps.deferAnchoredDrawings({
      paragraph,
      paragraphId,
      paragraphBox,
      lines,
      cellOriginX: placed.originX,
      cellContentWidth: placed.cellContentWidth,
    });
    return;
  }
  if (!deps.collectAnchoredDrawings) return;
  const cellBox = Object.freeze({
    x: placed.originX,
    y: placed.top,
    width: placed.cellContentWidth,
    height: Math.max(0, placed.maxBottom - placed.top),
  });
  deps.collectAnchoredDrawings(
    publishAnchoredDrawingsForParagraph({
      paragraph,
      paragraphId,
      paragraphBox,
      lines,
      drawingLayout: deps.inlineDrawingLayout,
      frameBase: deps.anchorFrameBase(),
      columnBox: deps.columnBoxForParagraph?.(paragraphBox) ?? paragraphBox,
      cellBox,
      cellContentBox: cellBox,
      pageClip: deps.pageContentClip(),
      cellAnchorScope: placed.anchorScope,
      measurer: deps.measurer,
      ...(deps.hostedStory ? { layoutTextboxStory: deps.hostedStory.layoutTextboxStoryFor } : {}),
      ...(deps.displayMode ? { displayMode: deps.displayMode } : {}),
      ...(deps.revisionAuthorFilter ? { revisionAuthorFilter: deps.revisionAuthorFilter } : {}),
    })
  );
}

/** A wrapping object its paragraph positions, and how far below the paragraph top it ends. */
interface ParagraphAnchorReach {
  readonly projection: DrawingProjection;
  readonly reach: number;
}

/**
 * Per immutable paragraph node: every layout pass asks this of every cell paragraph, and most
 * hold no object, so the walk runs once per paragraph.
 */
const reachByParagraph = new WeakMap<OoxmlElement, readonly ParagraphAnchorReach[]>();

function paragraphAnchorReaches(
  paragraph: OoxmlElement,
  drawingLayout: NonNullable<TableFlowDeps['inlineDrawingLayout']>
): readonly ParagraphAnchorReach[] {
  const cached = reachByParagraph.get(paragraph);
  if (cached) return cached;
  const reaches: ParagraphAnchorReach[] = [];
  for (const atom of anchoredDrawingAtomsInParagraph(paragraph, drawingLayout)) {
    const projection = atom.projection;
    const vertical = projection.position?.vertical;
    if (
      projection.hidden ||
      projection.anchor?.simplePos ||
      vertical?.relativeFrom !== 'paragraph' ||
      vertical.align !== null ||
      !wrapsText(projection.wrap)
    )
      continue;
    const offset = emuToPointsSafe(vertical.offsetEmu ?? 0);
    if (offset === null) continue;
    reaches.push({
      projection,
      reach: Math.max(0, offset) + measureInlineDrawing(projection).height,
    });
  }
  const frozen = Object.freeze(reaches);
  reachByParagraph.set(paragraph, frozen);
  return frozen;
}

/** The bottom of the lowest wrapping in-cell object this paragraph positions, if any. */
function paragraphAnchorBottom(
  paragraph: OoxmlElement,
  paragraphTop: number,
  deps: TableFlowDeps,
  scope: CellAnchorScope
): number | undefined {
  if (!deps.inlineDrawingLayout) return undefined;
  let lowest: number | undefined;
  for (const { projection, reach } of paragraphAnchorReaches(paragraph, deps.inlineDrawingLayout)) {
    if (!anchorLaidOutInCell(projection, scope)) continue;
    const bottom = paragraphTop + reach;
    if (lowest === undefined || bottom > lowest) lowest = bottom;
  }
  return lowest;
}

/**
 * A table cell's content bottom, grown to hold the wrapping objects its paragraphs lay out
 * in it. Story boxes that reuse cell flow (headers, footers, text boxes) keep their bottom.
 */
export function cellBottomWithAnchors(
  bottom: number,
  blocks: readonly OoxmlElement[],
  fragments: readonly BlockFragmentRecord[],
  deps: TableFlowDeps,
  inTableCell: boolean | undefined
): number {
  if (inTableCell !== true || !deps.inlineDrawingLayout || fragments.length === 0) return bottom;
  let grown = bottom;
  for (const fragment of fragments) {
    if (fragment.kind !== 'paragraph') continue;
    const paragraph = blocks.find((block) => block.id === fragment.paragraphId);
    if (!paragraph || paragraph.kind !== 'paragraph') continue;
    const scope = cellAnchorScope(true, deps, fragment.paragraphId);
    const anchorBottom = paragraphAnchorBottom(paragraph, fragment.box.y, deps, scope);
    if (anchorBottom !== undefined && anchorBottom > grown) grown = anchorBottom;
  }
  return grown;
}
