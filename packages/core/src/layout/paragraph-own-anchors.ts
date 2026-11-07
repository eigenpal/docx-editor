// The anchors a paragraph break synthesizes wrap for from its own text, by wrap kind.
//
// DOM-free. The break-time wrap synthesis follows the published records: a drawing the display
// mode resolves away publishes no record, so it reserves no line top and carves no hole.

import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  measureInlineDrawing,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
import { revisionMarkupHidesDrawing } from './revision-markup-projection.ts';
import { resolveParagraphAnchorPosition } from './paragraph-anchor-position.ts';
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

/**
 * The vertical extent a paragraph's leading paragraph-framed wrapping anchors need on its
 * page. Word moves the anchor paragraph to the next page when that band does not fit under
 * the preceding flow, even when the paragraph mark itself could sit beside the object.
 *
 * Only anchors at model offset 0 count: a later anchor belongs to a line the paragraph may
 * split before, so it must not price the whole paragraph.
 */
export function paragraphOwnAnchorBand(options: {
  readonly paragraph: OoxmlNode;
  readonly drawingLayout: InlineDrawingLayoutContext | undefined;
  readonly paragraphStartY: number;
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly displayMode: RevisionDisplayMode;
  readonly revisionAuthorFilter: RevisionAuthorFilter | undefined;
}): number {
  const paragraph = options.paragraph;
  if (!options.drawingLayout || paragraph.kind !== 'paragraph') return 0;
  const atoms = anchoredDrawingAtomsInParagraph(paragraph, options.drawingLayout);
  // A paragraph with text keeps its opening lines beside the object. Only an anchor-only
  // paragraph moves as a unit with its band.
  if (atoms.length === 0 || paragraphOffsetIndex(paragraph).length !== atoms.length) return 0;
  const offsets = drawingModelOffsetsInParagraph(paragraph);
  const { displayMode, revisionAuthorFilter } = options;
  let bottom = options.paragraphStartY;
  for (const atom of atoms) {
    if (
      !revisionsVisible(atom.revisions, displayMode, revisionAuthorFilter) ||
      revisionMarkupHidesDrawing(atom.revisions, displayMode, revisionAuthorFilter)
    )
      continue;
    if (offsets.get(atom.atomId) !== 0) continue;
    if (atom.projection.anchor?.simplePos) continue;
    const vertical = atom.projection.position?.vertical;
    if (vertical?.relativeFrom !== 'paragraph') continue;
    const resolved = resolveParagraphAnchorPosition(atom.projection, {
      contentLeft: options.contentLeft,
      contentRight: options.contentRight,
      lineY: options.paragraphStartY,
      ownerPartName: options.drawingLayout.ownerPartName,
    });
    if (resolved.layoutFallback) continue;
    bottom = Math.max(bottom, resolved.y + measureInlineDrawing(atom.projection).height);
  }
  return Math.max(0, bottom - options.paragraphStartY);
}
