// The first row and the first paragraph of a table (ECMA-376 Part 1, 17.4.37 `w:tbl`) as one
// revision view lays it out. `w:contextualSpacing` (17.3.1.9) compares the paragraph before a
// table with that paragraph, and the first row reads what the table follows. A row that the
// view omits and a paragraph that the view merges away do not count, so both sides read the
// table that the page shows.

import { flattenContentControls, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { mergedFlowBlocks } from './story-roots.ts';
import { planTableRow } from './table-structure-rows.ts';

/** The revision view that a flow lays out. */
export interface TableEdgeView {
  readonly displayMode?: RevisionDisplayMode;
  readonly revisionAuthorFilter?: RevisionAuthorFilter;
}

/** Where a table starts in one view. */
export interface TableOpening {
  /** The id of the first row (17.4.78 `w:tr`) that the view lays out. */
  readonly rowId?: string;
  /**
   * The first paragraph in document order: the first block of the first cell (17.4.65
   * `w:tc`) of that row, inside a nested table when one opens that cell.
   */
  readonly paragraph?: OoxmlElement;
}

/** Tables nested deeper than this at the start of a first cell answer no paragraph. */
const MAX_OPENING_DEPTH = 16;
const EMPTY: TableOpening = {};

const memo = new WeakMap<
  OoxmlElement,
  {
    readonly displayMode: RevisionDisplayMode;
    readonly authorFilter: RevisionAuthorFilter | undefined;
    readonly opening: TableOpening;
  }
>();

function readOpening(
  table: OoxmlElement,
  displayMode: RevisionDisplayMode,
  authorFilter: RevisionAuthorFilter | undefined,
  depth: number
): TableOpening {
  for (const row of flattenContentControls(table.children)) {
    if (row.kind !== 'tableRow' || !planTableRow(row, displayMode, authorFilter)) continue;
    const cell = flattenContentControls(row.children).find((node) => node.kind === 'tableCell');
    const first =
      cell?.kind === 'tableCell'
        ? mergedFlowBlocks(cell.children, displayMode, authorFilter)[0]
        : undefined;
    if (first?.kind !== 'table') return { rowId: row.id, paragraph: first };
    if (depth >= MAX_OPENING_DEPTH) return { rowId: row.id };
    const nested = readOpening(first, displayMode, authorFilter, depth + 1);
    return { rowId: row.id, paragraph: nested.paragraph };
  }
  return EMPTY;
}

/** The {@link TableOpening} of `table` in `view`; the default view shows all markup. */
export function tableOpening(table: OoxmlElement, view?: TableEdgeView): TableOpening {
  const displayMode = view?.displayMode ?? DEFAULT_REVISION_DISPLAY_MODE;
  const authorFilter = view?.revisionAuthorFilter;
  const known = memo.get(table);
  if (known && known.displayMode === displayMode && known.authorFilter === authorFilter) {
    return known.opening;
  }
  const opening = readOpening(table, displayMode, authorFilter, 0);
  memo.set(table, { displayMode, authorFilter, opening });
  return opening;
}
