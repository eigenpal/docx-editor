/**
 * Map comment-mark / tracked-change positions in the ProseMirror document
 * to vertical pixel offsets inside the visible scroll container, so the
 * comments + tracked-changes sidebar can render markers aligned with
 * their anchor text. Uses caret-position lookup for paragraphs/images
 * and walks table fragments row-by-row for table content.
 */

import type { EditorView } from 'prosemirror-view';
import { getCaretPosition, pageTopOffset } from '@eigenpal/docx-editor-core/layout-bridge';
import type {
  FlowBlock,
  Layout,
  Measure,
  TableBlock,
  TableMeasure,
} from '@eigenpal/docx-editor-core/layout-engine';
import { VIEWPORT_PADDING_TOP } from './styles';

/**
 * Compute anchor Y positions for comments/tracked-changes sidebar.
 * Uses getCaretPosition for paragraphs/images; for table content, finds
 * the containing fragment and drills into rows for exact Y offset.
 * Returns a Map of "comment-{id}" / "revision-{revisionId}" → scroll-container Y.
 */
export function computeAnchorPositions(
  pmView: EditorView | null,
  layout: Layout,
  blocks: FlowBlock[],
  measures: Measure[],
  renderedPageGap: number
): Map<string, number> {
  const positions = new Map<string, number>();
  if (!pmView?.state) return positions;

  const { doc: pmDoc, schema } = pmView.state;
  const commentType = schema.marks.comment;
  const insertionType = schema.marks.insertion;
  const deletionType = schema.marks.deletion;
  if (!commentType && !insertionType && !deletionType) return positions;

  const seen = new Set<string>();
  // Offset from layout coords to scroll-container coords:
  // viewport paddingTop + pages container padding (CSS padding = pageGap)
  const contentOffset = VIEWPORT_PADDING_TOP + renderedPageGap;

  pmDoc.descendants((node, pos) => {
    if (!node.isText) return;
    for (const mark of node.marks) {
      let key: string | null = null;
      if (commentType && mark.type === commentType) {
        key = `comment-${mark.attrs.commentId}`;
      } else if (
        (insertionType && mark.type === insertionType) ||
        (deletionType && mark.type === deletionType)
      ) {
        key = `revision-${mark.attrs.revisionId}`;
      }
      if (!key || seen.has(key)) continue;
      seen.add(key);

      // Try exact position (paragraphs/images)
      const caret = getCaretPosition(layout, blocks, measures, pos);
      if (caret) {
        positions.set(key, caret.y + contentOffset);
        continue;
      }

      // Fallback: find containing fragment (tables, etc.) by PM position
      for (let pi = 0; pi < layout.pages.length; pi++) {
        const page = layout.pages[pi];
        let found = false;
        for (const frag of page.fragments) {
          const fStart = frag.docFrom ?? 0;
          const fEnd = (frag as { docTo?: number }).docTo ?? fStart;
          if (pos < fStart || pos > fEnd) continue;

          const rowOffsetY =
            frag.kind === 'table' ? getTableRowOffset(blocks, measures, frag, pos) : 0;
          positions.set(key, frag.y + rowOffsetY + pageTopOffset(layout, pi) + contentOffset);
          found = true;
          break;
        }
        if (found) break;
      }
    }
  });

  return positions;
}

/**
 * Find the Y offset within a table fragment to the row containing a PM position.
 * Sums row heights until finding the row that contains the given position.
 */
function getTableRowOffset(
  blocks: FlowBlock[],
  measures: Measure[],
  frag: { blockId: string | number; fromRow: number; toRow: number },
  pmPos: number
): number {
  const blockIdx = blocks.findIndex((b) => b.id === frag.blockId);
  if (blockIdx === -1) return 0;
  const tBlock = blocks[blockIdx];
  const tMeasure = measures[blockIdx];
  if (tBlock.kind !== 'table' || tMeasure.kind !== 'table') return 0;

  let offsetY = 0;
  for (let ri = frag.fromRow; ri < frag.toRow; ri++) {
    const row = (tBlock as TableBlock).rows[ri];
    if (!row) break;
    const posInRow = row.cells.some((cell) =>
      cell.blocks.some((b) => {
        const s = (b as { docFrom?: number }).docFrom ?? 0;
        const e = (b as { docTo?: number }).docTo ?? s;
        return pmPos >= s && pmPos <= e;
      })
    );
    if (posInRow) break;
    offsetY += (tMeasure as TableMeasure).rows[ri]?.height ?? 0;
  }
  return offsetY;
}
