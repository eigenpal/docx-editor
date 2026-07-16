/**
 * Re-export from @docx-editor.dev/core where the implementation now lives.
 * Kept for backward compatibility with in-package imports.
 */
export {
  type SplitCellDialogConfig,
  getSplitCellDialogConfig,
  splitActiveTableCell,
} from '@docx-editor.dev/core/prosemirror/commands';
