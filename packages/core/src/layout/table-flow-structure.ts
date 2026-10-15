// The table a body flow paginates: its structure at the column width, the page- or
// margin-positioned break that moves it into the flow, and whether it stays out of flow.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { readTableStructure, type SemanticTableStructure } from './semantic-table.ts';
import { autofitContextOf } from './table-autofit-widths.ts';
import type { TableFlowCursor } from './table-flow-cursor.ts';
import {
  pinnedBreakAtCursor,
  withSplittableRows,
  type PinnedTableBreak,
} from './table-pinned-break.ts';

export interface FlowTable {
  readonly structure: SemanticTableStructure;
  /** Set when a positioned table reaching below the bottom margin breaks in the body flow. */
  readonly pinnedBreak: PinnedTableBreak | undefined;
  /** A positioned table that keeps its sheet position. */
  readonly outOfFlow: boolean;
}

/** Read `table` for the flow at its column width; undefined when it has no rows. */
export function readFlowTable(table: OoxmlElement, flow: TableFlowCursor): FlowTable | undefined {
  const authored = readTableStructure(
    table,
    flow.columnWidth(),
    0,
    flow.styleCascade,
    flow.displayMode,
    flow.revisionAuthorFilter,
    flow.compatibilityMode,
    autofitContextOf(flow.deps)
  );
  if (!authored || authored.rows.length === 0) return undefined;
  // A page- or margin-positioned table that reaches below the bottom margin breaks across
  // pages in the body flow instead of keeping its sheet position (`table-pinned-break.ts`).
  const pinnedBreak = flow.positionTextTable
    ? undefined
    : pinnedBreakAtCursor(table, authored, flow);
  const structure = pinnedBreak ? withSplittableRows(authored) : authored;
  const outOfFlow =
    pinnedBreak === undefined &&
    structure.float !== undefined &&
    (structure.float.vertAnchor !== 'text' || flow.positionTextTable === true) &&
    structure.float.ySpec !== 'inline';
  return { structure, pinnedBreak, outOfFlow };
}
