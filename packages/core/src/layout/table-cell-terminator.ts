import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { isEmptyCellTerminator } from './story-roots.ts';

/** Where a cell's final paragraph sits in the cell walk. */
export interface CellTerminatorPosition {
  /** A real `w:tc`, not a header, footer, note or text-box story reusing cell flow. */
  readonly inTableCell: boolean;
  /** The paragraph is the cell's last block. */
  readonly last: boolean;
  /** The block before it emitted a nested table fragment. */
  readonly afterEmittedTable: boolean;
  /** The cell hides its end mark from row height (`w:hideMark`). */
  readonly hideEndMark: boolean;
  /** Content of this cell was already placed in the same fragment. */
  readonly afterPlacedContent: boolean;
}

/**
 * Whether the cell's final paragraph is placed at the content bottom without flow height.
 *
 * POSITION only. Whether the paragraph actually collapses is decided by what it would
 * publish, and `placeCellParagraph` owns that answer (`publishesPlacedGlyphs`): a list
 * marker or a visible tracked mark keeps its line.
 *
 * Two terminators qualify, and both must be empty (`isEmptyCellTerminator`):
 *
 * - The paragraph a cell must end with after a nested table. `afterEmittedTable` comes from
 *   the walk, not the source node's kind: a `w:tbl` past the nesting ceiling or with no
 *   `w:tr` emits nothing, and collapsing behind it leaves a row with no content and no
 *   terminator, which paints as a hairline.
 * - The empty last paragraph of a `w:hideMark` cell after other content. The end-of-cell
 *   mark does not count toward row height (17.4.25), and an empty final paragraph holds
 *   nothing else, so the row ends with the content above it: no line, spacing, or rule.
 *   An empty cell has no content above its mark and keeps the mark's line.
 */
export function cellTerminatorCollapses(
  block: OoxmlElement,
  position: CellTerminatorPosition
): boolean {
  if (!position.inTableCell || !position.last) return false;
  const terminator =
    position.afterEmittedTable || (position.hideEndMark && position.afterPlacedContent);
  return terminator && isEmptyCellTerminator(block);
}
