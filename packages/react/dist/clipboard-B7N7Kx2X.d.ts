import React__default, { CSSProperties, ReactNode } from 'react';
import { e as Table, a0 as TableCell, b as Run, a as Paragraph } from './agentApi-BVHzyk2l.js';

/**
 * Print Utilities
 *
 * Provides print functionality with:
 * - Print button component for toolbar
 * - Print-specific CSS styles
 * - Browser print dialog trigger
 * - Page range utilities
 */

/**
 * Print options
 */
interface PrintOptions {
  /** Whether to include headers */
  includeHeaders?: boolean;
  /** Whether to include footers */
  includeFooters?: boolean;
  /** Whether to include page numbers */
  includePageNumbers?: boolean;
  /** Page range to print (null = all) */
  pageRange?: {
    start: number;
    end: number;
  } | null;
  /** Scale factor for printing (1.0 = 100%) */
  scale?: number;
  /** Whether to show background colors */
  printBackground?: boolean;
  /** Margins mode */
  margins?: 'default' | 'none' | 'minimum';
}
/**
 * PrintButton props
 */
interface PrintButtonProps {
  /** Callback when print is triggered */
  onPrint: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Button label */
  label?: string;
  /** Additional CSS class */
  className?: string;
  /** Additional inline styles */
  style?: CSSProperties;
  /** Show icon */
  showIcon?: boolean;
  /** Compact mode */
  compact?: boolean;
}
/**
 * PrintButton - Standalone print button for toolbar
 */
declare function PrintButton({
  onPrint,
  disabled,
  label,
  className,
  style,
  showIcon,
  compact,
}: PrintButtonProps): React__default.ReactElement;
/**
 * PrintStyles - Injects print-specific CSS
 */
declare function PrintStyles(): React__default.ReactElement;
/**
 * Trigger browser print dialog for the current document
 */
declare function triggerPrint(): void;
/**
 * Create print-optimized document view in a new window
 */
declare function openPrintWindow(title: string | undefined, content: string): Window | null;
/**
 * Get default print options
 */
declare function getDefaultPrintOptions(): PrintOptions;
/**
 * Create page range from string (e.g., "1-5", "3", "1,3,5")
 */
declare function parsePageRange(
  input: string,
  maxPages: number
): {
  start: number;
  end: number;
} | null;
/**
 * Format page range for display
 */
declare function formatPageRange(
  range: {
    start: number;
    end: number;
  } | null,
  totalPages: number
): string;
/**
 * Check if browser supports good print functionality
 */
declare function isPrintSupported(): boolean;

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

/**
 * Table editing action types
 */
type TableAction =
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
  | {
      type: 'cellFillColor';
      color: string | null;
    }
  | {
      type: 'borderColor';
      color: string;
    }
  | {
      type: 'borderWidth';
      size: number;
    }
  | {
      type: 'cellBorder';
      side: 'top' | 'bottom' | 'left' | 'right' | 'all';
      style: string;
      size: number;
      color: string;
    }
  | {
      type: 'cellVerticalAlign';
      align: 'top' | 'center' | 'bottom';
    }
  | {
      type: 'cellMargins';
      margins: {
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
      };
    }
  | {
      type: 'cellTextDirection';
      direction: string | null;
    }
  | {
      type: 'toggleNoWrap';
    }
  | {
      type: 'rowHeight';
      height: number | null;
      rule?: 'auto' | 'atLeast' | 'exact';
    }
  | {
      type: 'toggleHeaderRow';
    }
  | {
      type: 'distributeColumns';
    }
  | {
      type: 'autoFitContents';
    }
  | {
      type: 'tableProperties';
      props: {
        width?: number | null;
        widthType?: string | null;
        justification?: 'left' | 'center' | 'right' | null;
      };
    }
  | {
      type: 'openTableProperties';
    }
  | {
      type: 'applyTableStyle';
      styleId: string;
    };
/**
 * Selection within a table
 */
interface TableSelection {
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
interface TableContext {
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
/**
 * Props for TableToolbar component
 */
interface TableToolbarProps {
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
 * TableToolbar - Shows table manipulation controls when cursor is in a table
 */
declare function TableToolbar({
  context,
  onAction,
  disabled,
  className,
  style,
  showLabels,
  compact,
  position,
  children,
}: TableToolbarProps): React__default.ReactElement | null;
/**
 * Create a table context from a table and selection
 */
declare function createTableContext(table: Table, selection: TableSelection): TableContext;
/**
 * Get column count from a table
 */
declare function getColumnCount(table: Table): number;
/**
 * Get cell at specific row and column index
 */
declare function getCellAt(table: Table, rowIndex: number, columnIndex: number): TableCell | null;
/**
 * Add a row to a table at the specified index
 */
declare function addRow(table: Table, atIndex: number, position?: 'before' | 'after'): Table;
/**
 * Delete a row from a table
 */
declare function deleteRow(table: Table, rowIndex: number): Table;
/**
 * Add a column to a table at the specified index
 */
declare function addColumn(table: Table, atIndex: number, position?: 'before' | 'after'): Table;
/**
 * Delete a column from a table
 */
declare function deleteColumn(table: Table, columnIndex: number): Table;
/**
 * Merge cells in a selection
 */
declare function mergeCells(table: Table, selection: TableSelection): Table;
/**
 * Split a merged cell
 */
declare function splitCell(table: Table, rowIndex: number, columnIndex: number): Table;

/**
 * Clipboard utilities for copy/paste with formatting
 *
 * Handles:
 * - Copy: puts formatted HTML and plain text on clipboard
 * - Paste: reads HTML clipboard, converts to runs with formatting
 * - Handles paste from Word (cleans up Word HTML)
 * - Ctrl+C, Ctrl+V, Ctrl+X keyboard shortcuts
 */

/**
 * Clipboard content format
 */
interface ClipboardContent {
  /** Plain text representation */
  plainText: string;
  /** HTML representation */
  html: string;
  /** Internal format (JSON) for preserving full formatting */
  internal?: string;
}
/**
 * Parsed clipboard content
 */
interface ParsedClipboardContent {
  /** Runs parsed from clipboard */
  runs: Run[];
  /** Whether content came from Word */
  fromWord: boolean;
  /** Whether content came from our editor */
  fromEditor: boolean;
  /** Original plain text */
  plainText: string;
}
/**
 * Options for clipboard operations
 */
interface ClipboardOptions {
  /** Whether to include formatting in copy */
  includeFormatting?: boolean;
  /** Whether to clean Word-specific formatting */
  cleanWordFormatting?: boolean;
  /** Callback for handling errors */
  onError?: (error: Error) => void;
}
/**
 * Custom MIME type for internal clipboard format
 */
declare const INTERNAL_CLIPBOARD_TYPE = 'application/x-docx-editor';
/**
 * Standard clipboard MIME types
 */
declare const CLIPBOARD_TYPES: {
  readonly HTML: 'text/html';
  readonly PLAIN: 'text/plain';
};
/**
 * Copy runs to clipboard with formatting
 */
declare function copyRuns(runs: Run[], options?: ClipboardOptions): Promise<boolean>;
/**
 * Copy paragraphs to clipboard with formatting
 */
declare function copyParagraphs(
  paragraphs: Paragraph[],
  options?: ClipboardOptions
): Promise<boolean>;
/**
 * Convert runs to clipboard content (HTML and plain text)
 */
declare function runsToClipboardContent(runs: Run[], includeFormatting?: boolean): ClipboardContent;
/**
 * Convert paragraphs to clipboard content
 */
declare function paragraphsToClipboardContent(
  paragraphs: Paragraph[],
  includeFormatting?: boolean
): ClipboardContent;
/**
 * Write content to clipboard
 */
declare function writeToClipboard(content: ClipboardContent): Promise<boolean>;
/**
 * Read content from clipboard
 */
declare function readFromClipboard(
  options?: ClipboardOptions
): Promise<ParsedClipboardContent | null>;
/**
 * Handle paste event
 */
declare function handlePasteEvent(
  event: ClipboardEvent,
  options?: ClipboardOptions
): ParsedClipboardContent | null;
/**
 * Parse HTML from clipboard
 */
declare function parseClipboardHtml(
  html: string,
  plainText: string,
  cleanWordFormatting?: boolean
): ParsedClipboardContent;
/**
 * Check if HTML is from Microsoft Word
 */
declare function isWordHtml(html: string): boolean;
/**
 * Check if HTML is from our editor
 */
declare function isEditorHtml(html: string): boolean;
/**
 * Clean Microsoft Word HTML
 */
declare function cleanWordHtml(html: string): string;
/**
 * Convert HTML to runs
 */
declare function htmlToRuns(html: string, plainTextFallback: string): Run[];
/**
 * Create clipboard keyboard handlers for an editor
 */
declare function createClipboardHandlers(options: {
  onCopy?: () => {
    runs: Run[];
  } | null;
  onCut?: () => {
    runs: Run[];
  } | null;
  onPaste?: (content: ParsedClipboardContent) => void;
  clipboardOptions?: ClipboardOptions;
}): {
  handleCopy: (event: ClipboardEvent) => Promise<void>;
  handleCut: (event: ClipboardEvent) => Promise<void>;
  handlePaste: (event: ClipboardEvent) => void;
  handleKeyDown: (event: KeyboardEvent) => Promise<void>;
};

export {
  isPrintSupported as A,
  isWordHtml as B,
  CLIPBOARD_TYPES as C,
  mergeCells as D,
  openPrintWindow as E,
  paragraphsToClipboardContent as F,
  parseClipboardHtml as G,
  parsePageRange as H,
  INTERNAL_CLIPBOARD_TYPE as I,
  readFromClipboard as J,
  runsToClipboardContent as K,
  splitCell as L,
  triggerPrint as M,
  writeToClipboard as N,
  type ParsedClipboardContent as P,
  type TableAction as T,
  type ClipboardContent as a,
  type ClipboardOptions as b,
  PrintButton as c,
  type PrintButtonProps as d,
  type PrintOptions as e,
  PrintStyles as f,
  type TableContext as g,
  type TableSelection as h,
  TableToolbar as i,
  type TableToolbarProps as j,
  addColumn as k,
  addRow as l,
  cleanWordHtml as m,
  copyParagraphs as n,
  copyRuns as o,
  createClipboardHandlers as p,
  createTableContext as q,
  deleteColumn as r,
  deleteRow as s,
  formatPageRange as t,
  getCellAt as u,
  getColumnCount as v,
  getDefaultPrintOptions as w,
  handlePasteEvent as x,
  htmlToRuns as y,
  isEditorHtml as z,
};
