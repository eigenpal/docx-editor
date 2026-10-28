// Where a dragged table can land: before each of its siblings, at the top of that block's
// first painted fragment.

import type { OoxmlPart } from '../store/package/ooxml-tree.ts';
import { parentOf } from '../store/store/tree-op-nodes.ts';
import type { BlockFragmentRecord, LayoutBox, SemanticLayout } from '../layout/semantic-records.ts';

export interface TableDropSlot {
  readonly beforeBlockId: string;
  readonly pageIndex: number;
  /** Story-local coordinates of the drop line, relative to `origin`. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly origin: LayoutBox;
}

/** Every slot the table could move to; the two that would leave it in place are left out. */
export function tableDropSlots(
  layout: SemanticLayout,
  part: OoxmlPart,
  tableId: string
): TableDropSlot[] {
  const parent = parentOf(part, tableId);
  if (!parent) return [];
  const blocks = parent.children.filter(
    (child) => child.kind === 'paragraph' || child.kind === 'table'
  );
  const index = blocks.findIndex((block) => block.id === tableId);
  const candidates = new Set(
    blocks.filter((_, at) => at !== index && at !== index + 1).map((block) => block.id)
  );
  const slots: TableDropSlot[] = [];
  const visit = (
    fragments: readonly BlockFragmentRecord[],
    pageIndex: number,
    origin: LayoutBox
  ): void => {
    for (const fragment of fragments) {
      const id = fragment.kind === 'paragraph' ? fragment.paragraphId : fragment.tableId;
      if (fragment.fragmentIndex === 0 && candidates.has(id)) {
        const { x, y, width } = fragment.box;
        slots.push({ beforeBlockId: id, pageIndex, x, y, width, origin });
      }
      if (fragment.kind === 'table') {
        for (const row of fragment.rows) {
          for (const cell of row.cells) visit(cell.blocks, pageIndex, origin);
        }
      }
    }
  };
  layout.pages.forEach((page, pageIndex) => {
    visit(page.fragments, pageIndex, page.contentBox);
    for (const story of [page.header, page.footer]) {
      if (story) visit(story.fragments, pageIndex, story.box);
    }
  });
  return slots;
}

/** The slot whose line is closest to a sheet-space point, or null when there are none. */
export function nearestTableDropSlot(
  slots: readonly TableDropSlot[],
  sheetY: number
): TableDropSlot | null {
  let best: TableDropSlot | null = null;
  for (const slot of slots) {
    const distance = Math.abs(slot.origin.y + slot.y - sheetY);
    if (!best || distance < Math.abs(best.origin.y + best.y - sheetY)) best = slot;
  }
  return best;
}
