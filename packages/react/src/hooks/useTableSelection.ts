/**
 * useTableSelection Hook
 *
 * Thin React wrapper around the framework-agnostic TableSelectionManager.
 * Provides table selection tracking and table operation dispatch.
 */

import { useState, useCallback, useSyncExternalStore, useMemo } from 'react';
import {
  TableSelectionManager,
  getTableFromDocument,
  updateTableInDocument,
  deleteTableFromDocument,
} from '@eigenpal/docx-core';
import type { Document, Table } from '@eigenpal/docx-core/types/document';
import type { TableContext, TableSelection, TableAction } from '../components/ui/TableToolbar';
import {
  createTableContext,
  addRow,
  deleteRow,
  addColumn,
  deleteColumn,
  mergeCells,
  splitCell,
  getColumnCount,
} from '../components/ui/TableToolbar';

// ============================================================================
// RE-EXPORTS (backwards compat)
// ============================================================================

export {
  TABLE_DATA_ATTRIBUTES,
  findTableFromClick,
  getTableFromDocument,
  updateTableInDocument,
  deleteTableFromDocument,
} from '@eigenpal/docx-core';
export type { CellCoordinates } from '@eigenpal/docx-core';

// ============================================================================
// TYPES
// ============================================================================

export interface TableSelectionState {
  context: TableContext | null;
  table: Table | null;
  tableIndex: number | null;
  rowIndex: number | null;
  columnIndex: number | null;
}

export interface UseTableSelectionReturn {
  state: TableSelectionState;
  handleCellClick: (tableIndex: number, rowIndex: number, columnIndex: number) => void;
  handleAction: (action: TableAction) => void;
  clearSelection: () => void;
  isCellSelected: (tableIndex: number, rowIndex: number, columnIndex: number) => boolean;
  tableContext: TableContext | null;
}

export interface UseTableSelectionOptions {
  document: Document | null;
  onChange?: (document: Document) => void;
  onSelectionChange?: (context: TableContext | null) => void;
}

// ============================================================================
// HOOK
// ============================================================================

export function useTableSelection({
  document: doc,
  onChange,
  onSelectionChange,
}: UseTableSelectionOptions): UseTableSelectionReturn {
  // Create the manager once
  const manager = useMemo(() => new TableSelectionManager(), []);

  // Subscribe to core manager state
  const coreSnapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot);

  // Higher-level state that includes table context (depends on doc + core selection)
  const [state, setState] = useState<TableSelectionState>({
    context: null,
    table: null,
    tableIndex: null,
    rowIndex: null,
    columnIndex: null,
  });

  const handleCellClick = useCallback(
    (tableIndex: number, rowIndex: number, columnIndex: number) => {
      if (!doc) return;

      const table = getTableFromDocument(doc, tableIndex);
      if (!table) {
        manager.clearSelection();
        setState({
          context: null,
          table: null,
          tableIndex: null,
          rowIndex: null,
          columnIndex: null,
        });
        return;
      }

      manager.selectCell({ tableIndex, rowIndex, columnIndex });

      const selection: TableSelection = { tableIndex, rowIndex, columnIndex };
      const context = createTableContext(table, selection);

      setState({ context, table, tableIndex, rowIndex, columnIndex });
      onSelectionChange?.(context);
    },
    [doc, manager, onSelectionChange]
  );

  const clearSelection = useCallback(() => {
    manager.clearSelection();
    setState({
      context: null,
      table: null,
      tableIndex: null,
      rowIndex: null,
      columnIndex: null,
    });
    onSelectionChange?.(null);
  }, [manager, onSelectionChange]);

  const handleAction = useCallback(
    (action: TableAction) => {
      if (
        !doc ||
        !state.context ||
        state.tableIndex === null ||
        state.rowIndex === null ||
        state.columnIndex === null
      ) {
        return;
      }

      const table = state.table;
      if (!table) return;

      let newTable: Table | null = null;
      let newDoc: Document | null = null;
      let newRowIndex = state.rowIndex;
      let newColumnIndex = state.columnIndex;

      switch (action) {
        case 'addRowAbove':
          newTable = addRow(table, state.rowIndex, 'before');
          newRowIndex = state.rowIndex + 1;
          break;

        case 'addRowBelow':
          newTable = addRow(table, state.rowIndex, 'after');
          break;

        case 'addColumnLeft':
          newTable = addColumn(table, state.columnIndex, 'before');
          newColumnIndex = state.columnIndex + 1;
          break;

        case 'addColumnRight':
          newTable = addColumn(table, state.columnIndex, 'after');
          break;

        case 'deleteRow':
          if (table.rows.length > 1) {
            newTable = deleteRow(table, state.rowIndex);
            if (newRowIndex >= newTable.rows.length) {
              newRowIndex = newTable.rows.length - 1;
            }
          }
          break;

        case 'deleteColumn': {
          const colCount = getColumnCount(table);
          if (colCount > 1) {
            newTable = deleteColumn(table, state.columnIndex);
            const newColCount = getColumnCount(newTable);
            if (newColumnIndex >= newColCount) {
              newColumnIndex = newColCount - 1;
            }
          }
          break;
        }

        case 'mergeCells':
          if (state.context.selection.selectedCells) {
            newTable = mergeCells(table, state.context.selection);
          }
          break;

        case 'splitCell':
          if (state.context.canSplitCell) {
            newTable = splitCell(table, state.rowIndex, state.columnIndex);
          }
          break;

        case 'deleteTable':
          newDoc = deleteTableFromDocument(doc, state.tableIndex);
          clearSelection();
          onChange?.(newDoc);
          return;
      }

      if (newTable) {
        newDoc = updateTableInDocument(doc, state.tableIndex, newTable);
        onChange?.(newDoc);

        if (newDoc) {
          handleCellClick(state.tableIndex, newRowIndex, newColumnIndex);
        }
      }
    },
    [doc, state, onChange, clearSelection, handleCellClick]
  );

  const isCellSelected = useCallback(
    (tableIndex: number, rowIndex: number, columnIndex: number): boolean => {
      return manager.isCellSelected(tableIndex, rowIndex, columnIndex);
    },
    [manager, coreSnapshot] // re-derive when core snapshot changes
  );

  return {
    state,
    handleCellClick,
    handleAction,
    clearSelection,
    isCellSelected,
    tableContext: state.context,
  };
}

export default useTableSelection;
