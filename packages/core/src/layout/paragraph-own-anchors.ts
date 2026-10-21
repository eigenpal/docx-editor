// The anchors a paragraph break synthesizes wrap for from its own text, by wrap kind.
//
// DOM-free. The break-time wrap synthesis follows the published records: a drawing the display
// mode resolves away publishes no record, so it reserves no line top and carves no hole.

import type { OoxmlNode } from '../store/package/ooxml-tree.ts';
import {
  anchoredDrawingAtomsInParagraph,
  drawingModelOffsetsInParagraph,
  type InlineDrawingLayoutContext,
} from './drawing-layout.ts';
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
