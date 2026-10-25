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
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
} from './drawing-atom-walk.ts';
import {
  emuToPointsSafe,
  measureInlineDrawing,
  publishAnchoredDrawingsForParagraph,
} from './drawing-layout.ts';
import { revisionMarkupHidesDrawing } from './revision-markup-projection.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  projectedRevisions,
  type RevisionAttribution,
} from './revision-projection.ts';
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

/**
 * A wrapping object its paragraph positions, and how far below the paragraph top it ends.
 * `start` is its model offset in the paragraph; `revisions` decide whether a display mode
 * shows it.
 */
interface ParagraphAnchorReach {
  readonly projection: DrawingProjection;
  readonly start: number;
  readonly revisions: readonly RevisionAttribution[];
  readonly reach: number;
}

/**
 * Per immutable paragraph node: every layout pass asks this of every cell paragraph, and most
 * hold no object, so the walk runs once per paragraph. The entries hold for every display
 * mode; the caller filters them by revision.
 */
const reachByParagraph = new WeakMap<OoxmlElement, readonly ParagraphAnchorReach[]>();

function paragraphAnchorReaches(
  paragraph: OoxmlElement,
  drawingLayout: NonNullable<TableFlowDeps['inlineDrawingLayout']>
): readonly ParagraphAnchorReach[] {
  const cached = reachByParagraph.get(paragraph);
  if (cached) return cached;
  const reaches: ParagraphAnchorReach[] = [];
  const atoms = anchoredDrawingAtomsInParagraph(paragraph, drawingLayout);
  const offsets = atoms.length > 0 ? drawingModelOffsetsInParagraph(paragraph) : null;
  for (const atom of atoms) {
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
    const start = offsets?.get(atom.atomId);
    if (offset === null || start === undefined) continue;
    reaches.push({
      projection,
      start,
      revisions: atom.revisions,
      reach: Math.max(0, offset) + measureInlineDrawing(projection).height,
    });
  }
  const frozen = Object.freeze(reaches);
  reachByParagraph.set(paragraph, frozen);
  return frozen;
}

/**
 * The bottom of the lowest wrapping in-cell object this paragraph fragment positions, if any.
 * As in publishing, an object counts only on the line that holds it and only when the display
 * mode shows it, so a split paragraph grows only the cell part that draws the object.
 */
function paragraphAnchorBottom(
  paragraph: OoxmlElement,
  fragment: { readonly box: LayoutBox; readonly lines: readonly LineRecord[] },
  deps: TableFlowDeps,
  scope: CellAnchorScope
): number | undefined {
  if (!deps.inlineDrawingLayout) return undefined;
  const paragraphTop = fragment.box.y;
  const displayMode = deps.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  let lowest: number | undefined;
  for (const anchor of paragraphAnchorReaches(paragraph, deps.inlineDrawingLayout)) {
    const { projection, start, revisions, reach } = anchor;
    if (!fragment.lines.some((line) => start >= line.range.start && start < line.range.end))
      continue;
    if (
      revisionMarkupHidesDrawing(revisions, displayMode, deps.revisionAuthorFilter) ||
      projectedRevisions(revisions, displayMode, deps.revisionAuthorFilter) === null
    )
      continue;
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
    const anchorBottom = paragraphAnchorBottom(paragraph, fragment, deps, scope);
    if (anchorBottom !== undefined && anchorBottom > grown) grown = anchorBottom;
  }
  return grown;
}
