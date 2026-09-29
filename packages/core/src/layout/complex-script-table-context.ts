// Reuse table layout's conditional-style selection for font writes.
import type { FormattingRevisionAuthorFilter } from '../store/store/formattable-runs.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import type { OoxmlNode, OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { RevisionAuthorFilter, RevisionDisplayMode } from './revision-projection.ts';
import { readTableStructure } from './semantic-table.ts';
import type { StyleCascadeTable, TableCellStyleFormatting } from './style-cascade.ts';

const filters = new WeakMap<FormattingRevisionAuthorFilter, RevisionAuthorFilter>();
let filterId = 0;
function layoutFilter(
  filter: FormattingRevisionAuthorFilter | undefined
): RevisionAuthorFilter | undefined {
  if (!filter) return undefined;
  let resolved = filters.get(filter);
  if (!resolved) {
    resolved = { ...filter, cacheKey: `formatting-${++filterId}` };
    filters.set(filter, resolved);
  }
  return resolved;
}

export function createFormattingCellStyles(cascade: StyleCascadeTable) {
  const tables = new WeakMap<
    OoxmlNode,
    {
      mode: RevisionDisplayMode;
      filter: RevisionAuthorFilter | undefined;
      cells: ReadonlyMap<string, TableCellStyleFormatting>;
    }
  >();
  return (
    part: OoxmlPart,
    paragraph: OoxmlNode,
    mode: RevisionDisplayMode,
    filter?: FormattingRevisionAuthorFilter
  ) => {
    const viewFilter = layoutFilter(filter);
    let owner = parentNodeOf(part, paragraph.id);
    let cellId: string | undefined;
    // The canonical parser bounds depth. Stop at a table so nested cells use their own style.
    while (owner && owner.kind !== 'table') {
      if (owner.localName === 'txbxContent') return undefined;
      if (owner.kind === 'tableCell') cellId = owner.id;
      owner = parentNodeOf(part, owner.id);
    }
    if (!owner || !cellId) return undefined;
    let indexed = tables.get(owner);
    if (!indexed || indexed.mode !== mode || indexed.filter !== viewFilter) {
      const cells = new Map<string, TableCellStyleFormatting>();
      // Width does not select conditional styles. No measuring or pagination occurs here.
      const structure = readTableStructure(owner, 1, 0, cascade, mode, viewFilter);
      for (const row of structure?.rows ?? []) {
        for (const cell of row.cells) cells.set(cell.id, cell.styleFormatting);
      }
      indexed = { mode, filter: viewFilter, cells };
      tables.set(owner, indexed);
    }
    return indexed.cells.get(cellId);
  };
}
