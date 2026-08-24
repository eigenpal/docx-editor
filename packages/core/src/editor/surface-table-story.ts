/**
 * Which story a table belongs to, and what that means for its chrome.
 *
 * Table interaction reaches every story the page draws, and three separate questions follow
 * from that: which part holds the table (planning reads its tree), which box its coordinates
 * are relative to (chrome is painted from that origin), and whether the reader is standing in
 * that story at all (a write commits under the open scope).
 *
 * Extracted from `surface-table-interaction.ts` to keep it under the line cap. These are pure
 * functions over ids and records, with no DOM and no host.
 */

import type { OoxmlPart } from '@docx-editor.dev/core/store';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import type {
  BlockFragmentRecord,
  LayoutBox,
  TableFragmentRecord,
} from '../layout/semantic-records.ts';
import type { TableInteractionHit } from '../layout/semantic-table-interaction.ts';

/** The part name a node id carries, or `''` when the id names none. */
export function partNameOf(nodeId: string): string {
  const hash = nodeId.indexOf('#');
  return hash === -1 ? '' : nodeId.slice(0, hash);
}

/**
 * The part a table lives in, for planning.
 *
 * Planning used to read `session.part()` — the body's — while the hit test resolved tables in
 * headers and footers. `readEditableTableTopology` then found no such table and the drag never
 * started, and `planTableCommand` refused with "the table target is no longer valid": chrome
 * offered, then a refusal. The id names the part, so this is a map lookup, not a story open.
 */
export function partOfTableIn(
  session: Pick<TreeDocxSessionView, 'currentPackage' | 'part'>,
  tableId: string
): OoxmlPart {
  const partName = partNameOf(tableId);
  if (partName.length === 0) return session.part();
  return session.currentPackage().parts.get(partName) ?? session.part();
}

/**
 * The hit worth painting chrome for, or `null`.
 *
 * Only the story the reader is IN. A write commits under the open scope, so a drag started
 * from the body on a header table would plan against the header part and then be refused by
 * the store. Word has the same rule: you enter the header before you can resize a table in it.
 * Painting chrome that cannot act is the failure this lane keeps producing.
 *
 * `openParagraphId` is the caret's paragraph. A paragraph id already carries its part name, so
 * this costs a string scan rather than a session read on every pointer move.
 */
export function offeredHit(
  hit: TableInteractionHit | null,
  openParagraphId: string
): TableInteractionHit | null {
  if (!hit || hit.kind === 'tableBody') return null;
  return partNameOf(hit.tableId) === partNameOf(openParagraphId) ? hit : null;
}

/**
 * A table on a page, with the box its coordinates are relative to.
 *
 * The origin is the reason this returns a pair rather than a record. Body fragments are laid
 * out from `page.contentBox`; a header's are laid out from the header's own box, which sits
 * ABOVE it, and a footer's from a box past the bottom of it. Returning the table alone let
 * every caller reach for `page.contentBox`, which drew a header's chrome down in the body text
 * and a footer's up at the top of it.
 */
export interface TableOnPage {
  readonly table: TableFragmentRecord;
  readonly origin: LayoutBox;
}

export function findTableOnPage(
  layout: SemanticLayout,
  tableId: string,
  pageIndex: number
): TableOnPage | null {
  const visit = (blocks: readonly BlockFragmentRecord[]): TableFragmentRecord | null => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue;
      if (block.tableId === tableId) return block;
      for (const row of block.rows) {
        for (const cell of row.cells) {
          const nested = visit(cell.blocks);
          if (nested) return nested;
        }
      }
    }
    return null;
  };
  const page = layout.pages[pageIndex];
  if (!page) return null;
  const inBody = visit(page.fragments);
  if (inBody) return { table: inBody, origin: page.contentBox };
  // The header and footer stories. A table in one was never found here, so the drag preview
  // bailed even once the hit test resolved it. Each carries its OWN box as the origin.
  for (const story of [page.header, page.footer]) {
    if (!story) continue;
    const found = visit(story.fragments);
    if (found) return { table: found, origin: story.box };
  }
  return null;
}
