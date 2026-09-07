import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import type { RevisionDisplayMode, RevisionAuthorFilter } from './revision-projection.ts';
import { readTableStructure } from './semantic-table.ts';

/** Walk top-level prepared blocks and table cell paragraphs in document order. */
export function paragraphDocumentOrderOf(
  prepared: readonly {
    readonly kind: 'paragraph' | 'table';
    readonly paragraph?: OoxmlElement;
    readonly table?: OoxmlElement;
  }[],
  contentWidth: number,
  styleCascade: StyleCascadeTable | undefined,
  displayMode: RevisionDisplayMode,
  authorFilter?: RevisionAuthorFilter,
  compatibilityMode?: number
): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  let index = 0;
  const walkTable = (table: OoxmlElement): void => {
    const structure = readTableStructure(
      table,
      contentWidth,
      0,
      styleCascade,
      displayMode,
      authorFilter,
      compatibilityMode
    );
    if (!structure) return;
    for (const row of structure.rows) {
      for (const cell of row.cells) {
        for (const block of cell.blocks) {
          if (block.localName === 'p') {
            order.set(block.id, index++);
          } else if (block.localName === 'tbl') {
            walkTable(block);
          }
        }
      }
    }
  };
  for (const block of prepared) {
    if (block.kind === 'paragraph' && block.paragraph) {
      order.set(block.paragraph.id, index++);
    } else if (block.kind === 'table' && block.table) {
      walkTable(block.table);
    }
  }
  return order;
}
