import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import { isCellTerminatorMarker, isEmptyCellTerminator } from './story-roots.ts';

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
 *   terminator, which paints as a hairline. Runs that hold no text keep it empty, in every
 *   mode: its spacing, mark size, exact line height, borders and shading take no room either.
 *   A space or a tab is text, and so is a second paragraph between it and the table.
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
  if (!terminator) return false;
  return isEmptyCellTerminator(block) || (position.afterEmittedTable && holdsNoText(block));
}

/** A bound on the empty runs read; a paragraph past it keeps its line. */
const MAX_EMPTY_RUNS = 64;

/**
 * Whether a paragraph holds only properties, structural markers and runs whose text is empty:
 * a run of `w:rPr` and empty `w:t` elements and nothing else.
 */
function holdsNoText(paragraph: OoxmlElement): boolean {
  let runs = 0;
  for (const child of paragraph.children) {
    if (isCellTerminatorMarker(child)) continue;
    if (child.kind === 'textValue' || child.namespaceUri !== WML_NAMESPACE_URI) return false;
    if (child.localName !== 'r' || ++runs > MAX_EMPTY_RUNS || !runHoldsNoText(child)) return false;
  }
  return true;
}

function runHoldsNoText(run: OoxmlElement): boolean {
  for (const part of run.children) {
    if (part.kind === 'textValue') {
      if (part.value.length > 0) return false;
      continue;
    }
    if (part.namespaceUri !== WML_NAMESPACE_URI) return false;
    if (part.localName === 'rPr') continue;
    if (part.localName !== 't') return false;
    for (const text of part.children)
      if (text.kind !== 'textValue' || text.value.length > 0) return false;
  }
  return true;
}
