// The anchors a paragraph break synthesizes wrap for from its own text, by wrap kind, and
// the page-fit bottom of the wrapping anchors each line holds.
//
// DOM-free. The break-time wrap synthesis follows the published records: a drawing the display
// mode resolves away publishes no record, so it reserves no line top and carves no hole.

import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  measureInlineDrawing,
  resolveAnchoredDrawingPosition,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
import { wrapsText } from './anchor-content-top.ts';
import type { BodyAnchorFrameBase } from './body-flow-helpers.ts';
import { placedTextboxProjection } from './drawing-exclusion.ts';
import type { TextboxStoryLayouter } from './inline-textbox-flow.ts';
import { revisionMarkupHidesDrawing } from './revision-markup-projection.ts';
import {
  revisionsVisible,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

export interface ParagraphOwnAnchorStarts {
  /** Model offsets of the `wp:wrapTopAndBottom` anchors. */
  readonly topAndBottom: ReadonlySet<number>;
  /**
   * The subset of {@link topAndBottom} whose band a `paragraph` frame places at a zero or
   * positive offset. That band starts from the paragraph's top, not from the anchor line, so it
   * can reach earlier lines. A band above the paragraph's top is left out.
   */
  readonly paragraphFramedTopAndBottom: ReadonlySet<number>;
  /** Model offsets of the anchors that wrap text beside them (square, tight, through). */
  readonly wrap: ReadonlySet<number>;
}

const NO_STARTS: ParagraphOwnAnchorStarts = Object.freeze({
  topAndBottom: new Set<number>(),
  paragraphFramedTopAndBottom: new Set<number>(),
  wrap: new Set<number>(),
});

/**
 * A remainder re-broken on a later page (`startOffset`) holds only the anchors in its own text.
 * A float anchored before it stays with the earlier lines; its band reaches this page only
 * through the zones the page publishes.
 */
export function paragraphOwnAnchorStarts(options: {
  readonly paragraph: OoxmlNode;
  readonly drawingLayout: InlineDrawingLayoutContext | undefined;
  readonly startOffset: number;
  readonly displayMode: RevisionDisplayMode;
  readonly revisionAuthorFilter: RevisionAuthorFilter | undefined;
}): ParagraphOwnAnchorStarts {
  if (!options.drawingLayout) return NO_STARTS;
  const topAndBottom = new Set<number>();
  const paragraphFramedTopAndBottom = new Set<number>();
  const wrap = new Set<number>();
  const offsets = drawingModelOffsetsInParagraph(options.paragraph);
  const { displayMode, revisionAuthorFilter } = options;
  for (const atom of anchoredDrawingAtomsInParagraph(options.paragraph, options.drawingLayout)) {
    if (
      !revisionsVisible(atom.revisions, displayMode, revisionAuthorFilter) ||
      revisionMarkupHidesDrawing(atom.revisions, displayMode, revisionAuthorFilter)
    )
      continue;
    const kind = atom.projection.wrap;
    if (kind === 'inline' || kind === 'behind' || kind === 'inFront') continue;
    const modelStart = offsets.get(atom.atomId);
    if (modelStart === undefined || modelStart < options.startOffset) continue;
    if (kind !== 'topAndBottom') {
      wrap.add(modelStart);
      continue;
    }
    topAndBottom.add(modelStart);
    const vertical = atom.projection.position?.vertical;
    if (
      vertical?.relativeFrom === 'paragraph' &&
      vertical.align === null &&
      (vertical.offsetEmu ?? 0) >= 0
    )
      paragraphFramedTopAndBottom.add(modelStart);
  }
  return { topAndBottom, paragraphFramedTopAndBottom, wrap };
}

/** The range and height of a broken line, as the page-fit rule reads it. */
interface AnchorLine {
  readonly start: number;
  readonly end: number;
  readonly height: number;
}

/**
 * The lowest bottom of the wrapping objects that one line of a body paragraph anchors, where
 * they publish when the line sits at `lineY`. Modern modes only; `-Infinity` when none.
 *
 * Placement already moved up every object that can end at the bottom margin
 * (`wrappedParagraphAnchorBottomTop`). A bottom past the margin therefore names an object that
 * cannot end there without rising above its line: the line moves to the next page, and an
 * object that still crosses the margin there ends the page.
 */
export function lineOwnAnchorBottom(options: {
  readonly paragraph: OoxmlNode;
  readonly drawingLayout: InlineDrawingLayoutContext | undefined;
  readonly frameBase: BodyAnchorFrameBase;
  readonly line: AnchorLine;
  readonly lastLine: boolean;
  readonly paragraphY: number;
  readonly lineY: number;
  readonly column: { readonly x: number; readonly width: number };
  readonly displayMode: RevisionDisplayMode;
  readonly revisionAuthorFilter: RevisionAuthorFilter | undefined;
  readonly layoutTextboxStory?: TextboxStoryLayouter;
}): number {
  const { paragraph, drawingLayout, frameBase, line } = options;
  if (!drawingLayout || frameBase.wrappedParagraphAnchorBottom !== 'margin') return -Infinity;
  const offsets = drawingModelOffsetsInParagraph(paragraph);
  if (offsets.size === 0) return -Infinity;
  const { displayMode, revisionAuthorFilter } = options;
  const columnBox = { x: options.column.x, y: options.paragraphY, width: options.column.width };
  let bottom = -Infinity;
  for (const atom of anchoredDrawingAtomsInParagraph(paragraph, drawingLayout)) {
    const start = offsets.get(atom.atomId);
    if (start === undefined || start < line.start) continue;
    if (start >= line.end && !(options.lastLine && start === line.end)) continue;
    if (
      !wrapsText(atom.projection.wrap) ||
      !revisionsVisible(atom.revisions, displayMode, revisionAuthorFilter) ||
      revisionMarkupHidesDrawing(atom.revisions, displayMode, revisionAuthorFilter)
    )
      continue;
    const frame = atom.projection.position?.vertical.relativeFrom;
    if (frame !== 'paragraph' && frame !== 'line') continue;
    const projection = placedTextboxProjection(atom.projection, options.layoutTextboxStory);
    const resolved = resolveAnchoredDrawingPosition(projection, {
      ...frameBase,
      paragraphBox: { ...columnBox, height: line.height },
      anchorLineBox: { ...columnBox, y: options.lineY, height: line.height },
      anchorCharacterX: options.column.x,
      columnBox: { ...columnBox, height: line.height },
      cellBox: null,
      layoutInCell: false,
    });
    if (resolved.layoutFallback) continue;
    bottom = Math.max(bottom, resolved.y + measureInlineDrawing(projection).height);
  }
  return bottom;
}

/** {@link lineOwnAnchorBottom} bound to one paragraph; the frame and column are read at use. */
export function createLineOwnAnchorBottom(options: {
  readonly paragraph: OoxmlNode;
  readonly drawingLayout: InlineDrawingLayoutContext | undefined;
  readonly frameBase: () => BodyAnchorFrameBase;
  readonly column: () => { readonly x: number; readonly width: number };
  readonly displayMode: RevisionDisplayMode;
  readonly revisionAuthorFilter: RevisionAuthorFilter | undefined;
  readonly layoutTextboxStory: TextboxStoryLayouter | undefined;
}): (line: AnchorLine | undefined, lastLine: boolean, paragraphY: number, lineY: number) => number {
  const { paragraph, drawingLayout } = options;
  if (!drawingLayout || drawingModelOffsetsInParagraph(paragraph).size === 0)
    return () => -Infinity;
  return (line, lastLine, paragraphY, lineY) =>
    line
      ? lineOwnAnchorBottom({
          ...options,
          frameBase: options.frameBase(),
          column: options.column(),
          line,
          lastLine,
          paragraphY,
          lineY,
        })
      : -Infinity;
}
