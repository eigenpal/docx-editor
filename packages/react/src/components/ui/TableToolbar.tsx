/**
 * TableToolbar Component
 *
 * Provides controls for editing tables:
 * - Add row above/below
 * - Add column left/right
 * - Delete row/column
 * - Merge cells
 * - Split cell
 *
 * Shows when cursor is in a table.
 */

import React from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Table, TableCell, TableRow } from '@eigenpal/docx-core/types/document';
import { MaterialSymbol } from './MaterialSymbol';
import { useTranslation } from '../../i18n';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Table editing action types
 */
export type TableAction =
  | 'addRowAbove'
  | 'addRowBelow'
  | 'addColumnLeft'
  | 'addColumnRight'
  | 'deleteRow'
  | 'deleteColumn'
  | 'mergeCells'
  | 'splitCell'
  | 'deleteTable'
  | 'selectTable'
  | 'selectRow'
  | 'selectColumn'
  | 'borderAll'
  | 'borderOutside'
  | 'borderInside'
  | 'borderNone'
  | 'borderTop'
  | 'borderBottom'
  | 'borderLeft'
  | 'borderRight'
  | { type: 'cellFillColor'; color: string | null }
  | { type: 'borderColor'; color: string }
  | { type: 'borderWidth'; size: number }
  | {
      type: 'cellBorder';
      side: 'top' | 'bottom' | 'left' | 'right' | 'all';
      style: string;
      size: number;
      color: string;
    }
  | { type: 'cellVerticalAlign'; align: 'top' | 'center' | 'bottom' }
  | {
      type: 'cellMargins';
      margins: { top?: number; bottom?: number; left?: number; right?: number };
    }
  | { type: 'cellTextDirection'; direction: string | null }
  | { type: 'toggleNoWrap' }
  | { type: 'rowHeight'; height: number | null; rule?: 'auto' | 'atLeast' | 'exact' }
  | { type: 'toggleHeaderRow' }
  | { type: 'distributeColumns' }
  | { type: 'autoFitContents' }
  | {
      type: 'tableProperties';
      props: {
        width?: number | null;
        widthType?: string | null;
        justification?: 'left' | 'center' | 'right' | null;
      };
    }
  | { type: 'openTableProperties' }
  | { type: 'applyTableStyle'; styleId: string };

/**
 * Border style preset
 */
export type BorderPreset =
  | 'all'
  | 'outside'
  | 'inside'
  | 'none'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right';

/**
 * Selection within a table
 */
export interface TableSelection {
  /** Index of the table in the document */
  tableIndex: number;
  /** Row index (0-indexed) */
  rowIndex: number;
  /** Column index (0-indexed) */
  columnIndex: number;
  /** Selected cell range for multi-cell selection */
  selectedCells?: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
}

/**
 * Context for table operations
 */
export interface TableContext {
  /** The table being edited */
  table: Table;
  /** Current selection within the table */
  selection: TableSelection;
  /** Whether multiple cells are selected (for merge) */
  hasMultiCellSelection: boolean;
  /** Whether current cell can be split */
  canSplitCell: boolean;
  /** Total number of rows */
  rowCount: number;
  /** Total number of columns */
  columnCount: number;
}

export interface TableSplitConfig {
  minRows: number;
  minCols: number;
  initialRows: number;
  initialCols: number;
}

/**
 * Props for TableToolbar component
 */
export interface TableToolbarProps {
  /** Current table context (null if cursor not in table) */
  context: TableContext | null;
  /** Callback when a table action is triggered */
  onAction?: (action: TableAction, context: TableContext) => void;
  /** Whether the toolbar is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Show labels next to icons */
  showLabels?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Position of the toolbar */
  position?: 'top' | 'floating';
  /** Custom render for additional buttons */
  children?: ReactNode;
}

/**
 * Props for individual table toolbar button
 */
export interface TableToolbarButtonProps {
  /** Action to trigger */
  action: TableAction;
  /** Button label */
  label: string;
  /** Button icon */
  icon: ReactNode;
  /** Button is disabled */
  disabled?: boolean;
  /** Click handler */
  onClick?: () => void;
  /** Show label */
  showLabel?: boolean;
  /** Compact mode */
  compact?: boolean;
  /** Keyboard shortcut hint */
  shortcut?: string;
}

// ============================================================================
// ICONS - Using Material Symbols
// ============================================================================

const ICON_SIZE = 16;

export function AddRowAboveIcon(): React.ReactElement {
  return <MaterialSymbol name="table_rows" size={ICON_SIZE} style={{ transform: 'scaleY(-1)' }} />;
}

export function AddRowBelowIcon(): React.ReactElement {
  return <MaterialSymbol name="table_rows" size={ICON_SIZE} />;
}

export function AddColumnLeftIcon(): React.ReactElement {
  return <MaterialSymbol name="view_column" size={ICON_SIZE} style={{ transform: 'scaleX(-1)' }} />;
}

export function AddColumnRightIcon(): React.ReactElement {
  return <MaterialSymbol name="view_column" size={ICON_SIZE} />;
}

export function DeleteRowIcon(): React.ReactElement {
  return <MaterialSymbol name="delete_sweep" size={ICON_SIZE} />;
}

export function DeleteColumnIcon(): React.ReactElement {
  return (
    <MaterialSymbol name="delete_sweep" size={ICON_SIZE} style={{ transform: 'rotate(90deg)' }} />
  );
}

export function MergeCellsIcon(): React.ReactElement {
  return <MaterialSymbol name="call_merge" size={ICON_SIZE} />;
}

export function SplitCellIcon(): React.ReactElement {
  return <MaterialSymbol name="call_split" size={ICON_SIZE} />;
}

export function DeleteTableIcon(): React.ReactElement {
  return <MaterialSymbol name="delete" size={ICON_SIZE} className="text-red-600" />;
}

// ============================================================================
// STYLES
// ============================================================================

const TOOLBAR_STYLES: Record<string, CSSProperties> = {
  container: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    backgroundColor: 'var(--doc-bg-subtle)',
    borderRadius: '4px',
    border: '1px solid var(--doc-border)',
    fontSize: '12px',
  },
  containerCompact: {
    padding: '2px 4px',
    gap: '2px',
  },
  containerFloating: {
    position: 'absolute',
    zIndex: 1000,
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
  },
  separator: {
    width: '1px',
    height: '20px',
    backgroundColor: 'var(--doc-border-dark)',
    margin: '0 4px',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    padding: '4px 8px',
    border: 'none',
    borderRadius: '3px',
    backgroundColor: 'transparent',
    color: 'var(--doc-text)',
    cursor: 'pointer',
    fontSize: '12px',
    lineHeight: '1',
    transition: 'background-color 0.15s, color 0.15s',
  },
  buttonCompact: {
    padding: '3px 5px',
  },
  buttonHover: {
    backgroundColor: 'var(--doc-border)',
  },
  buttonDisabled: {
    color: 'var(--doc-text-subtle)',
    cursor: 'not-allowed',
  },
  buttonDelete: {
    color: 'var(--doc-error)',
  },
  label: {
    fontSize: '11px',
    fontWeight: 500,
    color: 'var(--doc-text-muted)',
    marginRight: '8px',
    whiteSpace: 'nowrap',
  },
  hidden: {
    display: 'none',
  },
};

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * Individual toolbar button
 */
export function TableToolbarButton({
  action,
  label,
  icon,
  disabled = false,
  onClick,
  showLabel = false,
  compact = false,
  shortcut,
}: TableToolbarButtonProps): React.ReactElement {
  const [isHovered, setIsHovered] = React.useState(false);

  const isDeleteAction = typeof action === 'string' && action.startsWith('delete');

  const buttonStyle: CSSProperties = {
    ...TOOLBAR_STYLES.button,
    ...(compact ? TOOLBAR_STYLES.buttonCompact : {}),
    ...(isHovered && !disabled ? TOOLBAR_STYLES.buttonHover : {}),
    ...(disabled ? TOOLBAR_STYLES.buttonDisabled : {}),
    ...(isDeleteAction && !disabled ? TOOLBAR_STYLES.buttonDelete : {}),
  };

  const title = shortcut ? `${label} (${shortcut})` : label;

  return (
    <button
      type="button"
      className={`docx-table-toolbar-button docx-table-toolbar-${typeof action === 'string' ? action : action.type}`}
      style={buttonStyle}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={title}
      aria-label={label}
    >
      {icon}
      {showLabel && <span>{label}</span>}
    </button>
  );
}

/**
 * Button group with separator
 */
function ToolbarGroup({
  children,
  showSeparator = true,
}: {
  children: ReactNode;
  showSeparator?: boolean;
}): React.ReactElement {
  return (
    <>
      <div style={TOOLBAR_STYLES.group}>{children}</div>
      {showSeparator && <div style={TOOLBAR_STYLES.separator} />}
    </>
  );
}

/**
 * TableToolbar - Shows table manipulation controls when cursor is in a table
 */
export function TableToolbar({
  context,
  onAction,
  disabled = false,
  className,
  style,
  showLabels = false,
  compact = false,
  position = 'top',
  children,
}: TableToolbarProps): React.ReactElement | null {
  const { t } = useTranslation();

  // Don't render if not in a table
  if (!context) {
    return null;
  }

  const handleAction = (action: TableAction) => {
    if (!disabled && onAction && context) {
      onAction(action, context);
    }
  };

  // Check if actions are available
  const canDeleteRow = context.rowCount > 1;
  const canDeleteColumn = context.columnCount > 1;
  const canMerge = context.hasMultiCellSelection;
  const canSplit = context.canSplitCell;

  const containerStyle: CSSProperties = {
    ...TOOLBAR_STYLES.container,
    ...(compact ? TOOLBAR_STYLES.containerCompact : {}),
    ...(position === 'floating' ? TOOLBAR_STYLES.containerFloating : {}),
    ...style,
  };

  const classNames = ['docx-table-toolbar'];
  if (className) {
    classNames.push(className);
  }
  if (compact) {
    classNames.push('docx-table-toolbar-compact');
  }
  if (position === 'floating') {
    classNames.push('docx-table-toolbar-floating');
  }

  return (
    <div
      className={classNames.join(' ')}
      style={containerStyle}
      role="toolbar"
      aria-label={t('table.editingTools')}
    >
      <span style={TOOLBAR_STYLES.label}>{t('table.label')}</span>

      {/* Row operations */}
      <ToolbarGroup>
        <TableToolbarButton
          action="addRowAbove"
          label={t('table.insertRowAbove')}
          icon={<AddRowAboveIcon />}
          disabled={disabled}
          onClick={() => handleAction('addRowAbove')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="addRowBelow"
          label={t('table.insertRowBelow')}
          icon={<AddRowBelowIcon />}
          disabled={disabled}
          onClick={() => handleAction('addRowBelow')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="deleteRow"
          label={t('table.deleteRow')}
          icon={<DeleteRowIcon />}
          disabled={disabled || !canDeleteRow}
          onClick={() => handleAction('deleteRow')}
          showLabel={showLabels}
          compact={compact}
        />
      </ToolbarGroup>

      {/* Column operations */}
      <ToolbarGroup>
        <TableToolbarButton
          action="addColumnLeft"
          label={t('table.insertColumnLeft')}
          icon={<AddColumnLeftIcon />}
          disabled={disabled}
          onClick={() => handleAction('addColumnLeft')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="addColumnRight"
          label={t('table.insertColumnRight')}
          icon={<AddColumnRightIcon />}
          disabled={disabled}
          onClick={() => handleAction('addColumnRight')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="deleteColumn"
          label={t('table.deleteColumn')}
          icon={<DeleteColumnIcon />}
          disabled={disabled || !canDeleteColumn}
          onClick={() => handleAction('deleteColumn')}
          showLabel={showLabels}
          compact={compact}
        />
      </ToolbarGroup>

      {/* Merge/Split operations */}
      <ToolbarGroup showSeparator={false}>
        <TableToolbarButton
          action="mergeCells"
          label={t('table.mergeCells')}
          icon={<MergeCellsIcon />}
          disabled={disabled || !canMerge}
          onClick={() => handleAction('mergeCells')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="splitCell"
          label={t('table.splitCell')}
          icon={<SplitCellIcon />}
          disabled={disabled || !canSplit}
          onClick={() => handleAction('splitCell')}
          showLabel={showLabels}
          compact={compact}
        />
        <TableToolbarButton
          action="deleteTable"
          label={t('table.deleteTable')}
          icon={<DeleteTableIcon />}
          disabled={disabled}
          onClick={() => handleAction('deleteTable')}
          showLabel={showLabels}
          compact={compact}
        />
      </ToolbarGroup>

      {/* Custom content */}
      {children}
    </div>
  );
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Create a table context from a table and selection
 */
export function createTableContext(table: Table, selection: TableSelection): TableContext {
  const rowCount = table.rows.length;
  const columnCount = getColumnCount(table);

  // Check if multi-cell selection
  const hasMultiCellSelection = !!(
    selection.selectedCells &&
    (selection.selectedCells.startRow !== selection.selectedCells.endRow ||
      selection.selectedCells.startCol !== selection.selectedCells.endCol)
  );

  const currentCell = getCellAt(table, selection.rowIndex, selection.columnIndex);
  // Split is available for a single active cell. The UI opens a dialog and
  // applies the requested row/column split explicitly.
  const canSplitCell = !!currentCell && !hasMultiCellSelection;

  return {
    table,
    selection,
    hasMultiCellSelection,
    canSplitCell,
    rowCount,
    columnCount,
  };
}

/**
 * Get column count from a table
 */
export function getColumnCount(table: Table): number {
  if (!table.rows.length) return 0;

  let maxCols = 0;
  for (const row of table.rows) {
    let colCount = 0;
    for (const cell of row.cells) {
      colCount += cell.formatting?.gridSpan ?? 1;
    }
    maxCols = Math.max(maxCols, colCount);
  }
  return maxCols;
}

/**
 * Get cell at specific row and column index
 */
export function getCellAt(table: Table, rowIndex: number, columnIndex: number): TableCell | null {
  const row = table.rows[rowIndex];
  if (!row) return null;

  let currentCol = 0;
  for (const cell of row.cells) {
    const colspan = cell.formatting?.gridSpan ?? 1;
    if (columnIndex >= currentCol && columnIndex < currentCol + colspan) {
      return cell;
    }
    currentCol += colspan;
  }
  return null;
}

/**
 * Check if a selection spans multiple cells
 */
export function isMultiCellSelection(selection: TableSelection): boolean {
  if (!selection.selectedCells) return false;
  const { startRow, startCol, endRow, endCol } = selection.selectedCells;
  return startRow !== endRow || startCol !== endCol;
}

/**
 * Get the bounds of a selection
 */
export function getSelectionBounds(selection: TableSelection): {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
} {
  if (selection.selectedCells) {
    return selection.selectedCells;
  }
  return {
    startRow: selection.rowIndex,
    startCol: selection.columnIndex,
    endRow: selection.rowIndex,
    endCol: selection.columnIndex,
  };
}

/**
 * Check if a cell is within a selection
 */
export function isCellInSelection(
  rowIndex: number,
  colIndex: number,
  selection: TableSelection
): boolean {
  const bounds = getSelectionBounds(selection);
  return (
    rowIndex >= bounds.startRow &&
    rowIndex <= bounds.endRow &&
    colIndex >= bounds.startCol &&
    colIndex <= bounds.endCol
  );
}

/**
 * Create an empty row with the same structure as an existing row
 */
export function createEmptyRow(templateRow: TableRow, columnCount: number): TableRow {
  const cells: TableCell[] = [];

  // Create cells matching the column structure
  let colIndex = 0;
  for (const templateCell of templateRow.cells) {
    const colspan = templateCell.formatting?.gridSpan ?? 1;
    cells.push({
      type: 'tableCell',
      content: [
        {
          type: 'paragraph' as const,
          content: [],
          formatting: {},
        },
      ],
      formatting: {
        ...templateCell.formatting,
        vMerge: undefined, // Don't copy vertical merge
      },
    });
    colIndex += colspan;
  }

  // If template row has fewer columns, add more cells
  while (colIndex < columnCount) {
    cells.push({
      type: 'tableCell',
      content: [
        {
          type: 'paragraph' as const,
          content: [],
          formatting: {},
        },
      ],
      formatting: {},
    });
    colIndex++;
  }

  return {
    type: 'tableRow',
    cells,
    formatting: {
      ...templateRow.formatting,
      header: false, // New rows aren't headers by default
    },
  };
}

/**
 * Create an empty cell
 */
export function createEmptyCell(): TableCell {
  return {
    type: 'tableCell',
    content: [
      {
        type: 'paragraph',
        content: [],
        formatting: {},
      },
    ],
    formatting: {},
  };
}

interface DocumentTableAnchor {
  cell: TableCell;
  row: number;
  col: number;
  rowspan: number;
  colspan: number;
}

function getRowCellStartingAt(row: TableRow, targetCol: number): TableCell | null {
  let currentCol = 0;
  for (const cell of row.cells) {
    const colspan = cell.formatting?.gridSpan ?? 1;
    if (currentCol === targetCol) {
      return cell;
    }
    currentCol += colspan;
  }
  return null;
}

function collectDocumentTableAnchors(table: Table): {
  anchors: DocumentTableAnchor[];
  totalCols: number;
} {
  const anchors: DocumentTableAnchor[] = [];
  let totalCols = 0;

  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
    const row = table.rows[rowIndex];
    let colIndex = 0;

    for (const cell of row.cells) {
      const colspan = cell.formatting?.gridSpan ?? 1;
      if (cell.formatting?.vMerge !== 'continue') {
        let rowspan = 1;
        if (cell.formatting?.vMerge === 'restart') {
          for (let nextRow = rowIndex + 1; nextRow < table.rows.length; nextRow++) {
            const continuation = getRowCellStartingAt(table.rows[nextRow], colIndex);
            if (!continuation || continuation.formatting?.vMerge !== 'continue') break;
            rowspan += 1;
          }
        }

        anchors.push({
          cell,
          row: rowIndex,
          col: colIndex,
          rowspan,
          colspan,
        });
      }

      colIndex += colspan;
      totalCols = Math.max(totalCols, colIndex);
    }
  }

  return { anchors, totalCols };
}

function findDocumentTableAnchor(
  table: Table,
  rowIndex: number,
  columnIndex: number
): DocumentTableAnchor | null {
  const { anchors } = collectDocumentTableAnchors(table);
  return (
    anchors.find(
      (anchor) =>
        rowIndex >= anchor.row &&
        rowIndex < anchor.row + anchor.rowspan &&
        columnIndex >= anchor.col &&
        columnIndex < anchor.col + anchor.colspan
    ) ?? null
  );
}

function splitTableColumnWidths(
  table: Table,
  totalCols: number,
  startCol: number,
  currentSpan: number,
  targetSpan: number
): number[] | undefined {
  const existing =
    table.columnWidths && table.columnWidths.length > 0
      ? [...table.columnWidths]
      : Array.from({ length: totalCols }, () => 1440);

  const sliceWidth = existing
    .slice(startCol, startCol + currentSpan)
    .reduce((sum, width) => sum + width, 0);
  const baseWidth = Math.floor(sliceWidth / Math.max(targetSpan, 1));
  const remainder = sliceWidth - baseWidth * targetSpan;
  const replacement = Array.from(
    { length: targetSpan },
    (_, index) => baseWidth + (index < remainder ? 1 : 0)
  );

  return [
    ...existing.slice(0, startCol),
    ...replacement,
    ...existing.slice(startCol + currentSpan),
  ];
}

function toAnchorCellFormatting(cell: TableCell, colspan: number, rowspan: number) {
  const formatting = { ...(cell.formatting ?? {}) };
  if (colspan > 1) formatting.gridSpan = colspan;
  else delete formatting.gridSpan;
  if (rowspan > 1) formatting.vMerge = 'restart';
  else delete formatting.vMerge;
  return Object.keys(formatting).length ? formatting : undefined;
}

function toContinuationFormatting(cell: TableCell, colspan: number) {
  const formatting = { ...(cell.formatting ?? {}) };
  if (colspan > 1) formatting.gridSpan = colspan;
  else delete formatting.gridSpan;
  formatting.vMerge = 'continue';
  return formatting;
}

function createEmptySplitCell(template: TableCell): TableCell {
  return {
    type: 'tableCell',
    content: [{ type: 'paragraph', content: [], formatting: {} }],
    formatting: toAnchorCellFormatting(template, 1, 1),
  };
}

export function getTableSplitCellDialogConfig(
  table: Table,
  rowIndex: number,
  columnIndex: number
): TableSplitConfig | null {
  const anchor = findDocumentTableAnchor(table, rowIndex, columnIndex);
  if (!anchor) return null;

  return {
    minRows: anchor.rowspan,
    minCols: anchor.colspan,
    initialRows: anchor.rowspan,
    initialCols: anchor.rowspan > 1 || anchor.colspan > 1 ? anchor.colspan : anchor.colspan + 1,
  };
}

export function splitTableCell(
  table: Table,
  rowIndex: number,
  columnIndex: number,
  rows: number,
  cols: number
): Table {
  const { anchors, totalCols } = collectDocumentTableAnchors(table);
  const target = anchors.find(
    (anchor) =>
      rowIndex >= anchor.row &&
      rowIndex < anchor.row + anchor.rowspan &&
      columnIndex >= anchor.col &&
      columnIndex < anchor.col + anchor.colspan
  );
  if (!target) return table;
  if (rows < target.rowspan || cols < target.colspan) return table;
  if (rows === 1 && cols === 1) return table;

  const deltaRows = rows - target.rowspan;
  const deltaCols = cols - target.colspan;
  const targetRowEnd = target.row + target.rowspan;
  const targetColEnd = target.col + target.colspan;
  const nextAnchors: DocumentTableAnchor[] = [];

  for (const anchor of anchors) {
    if (anchor === target) continue;

    const rowEnd = anchor.row + anchor.rowspan;
    const colEnd = anchor.col + anchor.colspan;
    const rowIntersectsBand = anchor.row < targetRowEnd && rowEnd > target.row;
    const colIntersectsBand = anchor.col < targetColEnd && colEnd > target.col;

    nextAnchors.push({
      cell: anchor.cell,
      row: anchor.row >= targetRowEnd ? anchor.row + deltaRows : anchor.row,
      col: anchor.col >= targetColEnd ? anchor.col + deltaCols : anchor.col,
      rowspan:
        anchor.rowspan + (deltaRows > 0 && rowIntersectsBand && !colIntersectsBand ? deltaRows : 0),
      colspan:
        anchor.colspan + (deltaCols > 0 && colIntersectsBand && !rowIntersectsBand ? deltaCols : 0),
    });
  }

  for (let rowOffset = 0; rowOffset < rows; rowOffset++) {
    for (let colOffset = 0; colOffset < cols; colOffset++) {
      nextAnchors.push({
        cell:
          rowOffset === 0 && colOffset === 0
            ? {
                ...target.cell,
                formatting: toAnchorCellFormatting(target.cell, 1, 1),
              }
            : createEmptySplitCell(target.cell),
        row: target.row + rowOffset,
        col: target.col + colOffset,
        rowspan: 1,
        colspan: 1,
      });
    }
  }

  const anchorByStart = new Map<string, DocumentTableAnchor>();
  const anchorByCoveredSlot = new Map<string, DocumentTableAnchor>();
  for (const anchor of nextAnchors) {
    anchorByStart.set(`${anchor.row}-${anchor.col}`, anchor);
    for (let row = anchor.row; row < anchor.row + anchor.rowspan; row++) {
      for (let col = anchor.col; col < anchor.col + anchor.colspan; col++) {
        anchorByCoveredSlot.set(`${row}-${col}`, anchor);
      }
    }
  }

  const newRowCount = table.rows.length + deltaRows;
  const newColCount = totalCols + deltaCols;
  const newRows: TableRow[] = [];

  for (let row = 0; row < newRowCount; row++) {
    const sourceRow =
      row < targetRowEnd
        ? table.rows[row]
        : row < target.row + rows
          ? table.rows[targetRowEnd - 1]
          : table.rows[row - deltaRows];

    const cells: TableCell[] = [];
    for (let col = 0; col < newColCount; ) {
      const anchor = anchorByStart.get(`${row}-${col}`);
      if (anchor) {
        cells.push({
          ...anchor.cell,
          formatting: toAnchorCellFormatting(anchor.cell, anchor.colspan, anchor.rowspan),
        });
        col += anchor.colspan;
        continue;
      }

      const coveringAnchor = anchorByCoveredSlot.get(`${row}-${col}`);
      if (!coveringAnchor) {
        col += 1;
        continue;
      }

      cells.push({
        ...coveringAnchor.cell,
        content: [],
        formatting: toContinuationFormatting(coveringAnchor.cell, coveringAnchor.colspan),
      });
      col += coveringAnchor.colspan;
    }

    newRows.push({
      type: 'tableRow',
      formatting: sourceRow?.formatting ? { ...sourceRow.formatting } : undefined,
      cells,
    });
  }

  return {
    ...table,
    rows: newRows,
    columnWidths: splitTableColumnWidths(table, totalCols, target.col, target.colspan, cols),
  };
}

/**
 * Add a row to a table at the specified index
 */
export function addRow(
  table: Table,
  atIndex: number,
  position: 'before' | 'after' = 'after'
): Table {
  const newRows = [...table.rows];
  const insertIndex = position === 'before' ? atIndex : atIndex + 1;
  const templateRow = table.rows[atIndex] || table.rows[0];
  const columnCount = getColumnCount(table);
  const newRow = createEmptyRow(templateRow, columnCount);

  newRows.splice(insertIndex, 0, newRow);

  return {
    ...table,
    rows: newRows,
  };
}

/**
 * Delete a row from a table
 */
export function deleteRow(table: Table, rowIndex: number): Table {
  if (table.rows.length <= 1) {
    return table; // Don't delete the last row
  }

  const newRows = table.rows.filter((_, index) => index !== rowIndex);

  return {
    ...table,
    rows: newRows,
  };
}

/**
 * Add a column to a table at the specified index
 */
export function addColumn(
  table: Table,
  atIndex: number,
  position: 'before' | 'after' = 'after'
): Table {
  const insertIndex = position === 'before' ? atIndex : atIndex + 1;

  const newRows = table.rows.map((row) => {
    const newCells = [...row.cells];

    // Find the cell at the column index and insert a new cell
    let currentCol = 0;
    let insertCellIndex = 0;

    for (let i = 0; i < row.cells.length; i++) {
      const cell = row.cells[i];
      const colspan = cell.formatting?.gridSpan ?? 1;

      if (insertIndex <= currentCol + colspan) {
        insertCellIndex = position === 'before' ? i : i + 1;
        break;
      }
      currentCol += colspan;
      insertCellIndex = i + 1;
    }

    newCells.splice(insertCellIndex, 0, createEmptyCell());

    return {
      ...row,
      cells: newCells,
    };
  });

  // Update column widths if present
  let newColumnWidths = table.columnWidths;
  if (table.columnWidths && table.columnWidths.length > 0) {
    newColumnWidths = [...table.columnWidths];
    const templateWidth = table.columnWidths[atIndex] || table.columnWidths[0] || 1440; // Default 1 inch
    newColumnWidths.splice(insertIndex, 0, templateWidth);
  }

  return {
    ...table,
    rows: newRows,
    columnWidths: newColumnWidths,
  };
}

/**
 * Delete a column from a table
 */
export function deleteColumn(table: Table, columnIndex: number): Table {
  const columnCount = getColumnCount(table);
  if (columnCount <= 1) {
    return table; // Don't delete the last column
  }

  const newRows = table.rows.map((row) => {
    let currentCol = 0;
    const newCells: TableCell[] = [];

    for (const cell of row.cells) {
      const colspan = cell.formatting?.gridSpan ?? 1;

      // Check if this cell spans the column to delete
      if (columnIndex >= currentCol && columnIndex < currentCol + colspan) {
        if (colspan > 1) {
          // Reduce gridSpan by 1
          newCells.push({
            ...cell,
            formatting: {
              ...cell.formatting,
              gridSpan: colspan - 1,
            },
          });
        }
        // If colspan is 1, skip this cell (delete it)
      } else {
        newCells.push(cell);
      }

      currentCol += colspan;
    }

    return {
      ...row,
      cells: newCells,
    };
  });

  // Update column widths if present
  let newColumnWidths = table.columnWidths;
  if (table.columnWidths && table.columnWidths.length > columnIndex) {
    newColumnWidths = table.columnWidths.filter((_, i) => i !== columnIndex);
  }

  return {
    ...table,
    rows: newRows,
    columnWidths: newColumnWidths,
  };
}

/**
 * Merge cells in a selection
 */
export function mergeCells(table: Table, selection: TableSelection): Table {
  if (!selection.selectedCells) {
    return table;
  }

  const { startRow, startCol, endRow, endCol } = selection.selectedCells;
  const rowSpan = endRow - startRow + 1;
  const colSpan = endCol - startCol + 1;

  // Create new rows with merged cell
  const newRows = table.rows.map((row, rowIndex) => {
    if (rowIndex < startRow || rowIndex > endRow) {
      return row;
    }

    const newCells: TableCell[] = [];
    let currentCol = 0;

    for (const cell of row.cells) {
      const cellColSpan = cell.formatting?.gridSpan ?? 1;
      const cellEndCol = currentCol + cellColSpan - 1;

      // Check if this cell is in the selection
      const inSelection = currentCol <= endCol && cellEndCol >= startCol;

      if (!inSelection) {
        newCells.push(cell);
      } else if (rowIndex === startRow && currentCol === startCol) {
        // This is the top-left cell - it becomes the merged cell
        newCells.push({
          ...cell,
          formatting: {
            ...cell.formatting,
            gridSpan: colSpan,
            vMerge: rowSpan > 1 ? 'restart' : undefined,
          },
        });
      } else if (rowIndex > startRow && currentCol === startCol) {
        // Cells below the first row in merge area
        newCells.push({
          ...cell,
          formatting: {
            ...cell.formatting,
            gridSpan: colSpan,
            vMerge: 'continue',
          },
        });
      }
      // Skip other cells in the selection

      currentCol += cellColSpan;
    }

    return {
      ...row,
      cells: newCells,
    };
  });

  return {
    ...table,
    rows: newRows,
  };
}

/**
 * Backward-compatible helper for callers that still use the older merged-cell
 * split behavior directly.
 *
 * User-facing Split cell is now dialog-driven. For document-model tables, use
 * `getTableSplitCellDialogConfig()` and `splitTableCell()` instead.
 */
export function splitCell(table: Table, rowIndex: number, columnIndex: number): Table {
  const cell = getCellAt(table, rowIndex, columnIndex);
  if (!cell) return table;

  const gridSpan = cell.formatting?.gridSpan ?? 1;
  const isVMergeStart = cell.formatting?.vMerge === 'restart';

  if (gridSpan <= 1 && !isVMergeStart) {
    return table; // Nothing to split
  }

  const newRows = table.rows.map((row, rIndex) => {
    if (rIndex !== rowIndex && !isVMergeStart) {
      return row;
    }

    const newCells: TableCell[] = [];
    let currentCol = 0;

    for (const rowCell of row.cells) {
      const cellColSpan = rowCell.formatting?.gridSpan ?? 1;

      if (
        currentCol === columnIndex ||
        (currentCol <= columnIndex && columnIndex < currentCol + cellColSpan)
      ) {
        // This is the cell to split
        if (gridSpan > 1) {
          // Split horizontally
          for (let i = 0; i < gridSpan; i++) {
            newCells.push({
              type: 'tableCell',
              content:
                i === 0
                  ? rowCell.content
                  : [{ type: 'paragraph' as const, content: [], formatting: {} }],
              formatting: {
                ...rowCell.formatting,
                gridSpan: undefined,
                vMerge: undefined,
              },
            });
          }
        } else if (isVMergeStart && rIndex === rowIndex) {
          // Remove vMerge from this cell
          newCells.push({
            ...rowCell,
            formatting: {
              ...rowCell.formatting,
              vMerge: undefined,
            },
          });
        } else if (rowCell.formatting?.vMerge === 'continue') {
          // This row was part of vMerge - restore as regular cell
          newCells.push({
            type: 'tableCell',
            content: [{ type: 'paragraph' as const, content: [], formatting: {} }],
            formatting: {
              ...rowCell.formatting,
              vMerge: undefined,
            },
          });
        } else {
          newCells.push(rowCell);
        }
      } else {
        newCells.push(rowCell);
      }

      currentCol += cellColSpan;
    }

    return {
      ...row,
      cells: newCells,
    };
  });

  return {
    ...table,
    rows: newRows,
  };
}

/** Simple (string) table actions */
type SimpleTableAction = Exclude<TableAction, { type: string }>;

/**
 * Get action label for display
 */
export function getActionLabel(action: TableAction): string {
  if (typeof action === 'object') {
    if (action.type === 'cellFillColor') return 'Cell Fill Color';
    if (action.type === 'borderColor') return 'Border Color';
    return 'Unknown Action';
  }

  const labels: Record<SimpleTableAction, string> = {
    addRowAbove: 'Insert Row Above',
    addRowBelow: 'Insert Row Below',
    addColumnLeft: 'Insert Column Left',
    addColumnRight: 'Insert Column Right',
    deleteRow: 'Delete Row',
    deleteColumn: 'Delete Column',
    mergeCells: 'Merge Cells',
    splitCell: 'Split Cell',
    deleteTable: 'Delete Table',
    selectTable: 'Select Table',
    selectRow: 'Select Row',
    selectColumn: 'Select Column',
    borderAll: 'All Borders',
    borderOutside: 'Outside Borders',
    borderInside: 'Inside Borders',
    borderNone: 'No Borders',
    borderTop: 'Top Border',
    borderBottom: 'Bottom Border',
    borderLeft: 'Left Border',
    borderRight: 'Right Border',
  };
  return labels[action];
}

/**
 * Check if an action is a delete action
 */
export function isDeleteAction(action: TableAction): boolean {
  return (
    typeof action === 'string' &&
    (action === 'deleteRow' || action === 'deleteColumn' || action === 'deleteTable')
  );
}

/**
 * Handle keyboard shortcuts for table actions
 */
export function handleTableShortcut(
  _event: KeyboardEvent,
  context: TableContext | null
): TableAction | null {
  if (!context) return null;

  // No default keyboard shortcuts defined for table operations
  // This function can be extended to add shortcuts like:
  // - Ctrl+Shift+R for add row
  // - Ctrl+Shift+C for add column
  // etc.

  return null;
}

export default TableToolbar;
