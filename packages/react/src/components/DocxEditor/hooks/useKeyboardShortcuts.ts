import { useEffect } from 'react';
import {
  getHyperlinkAttrs,
  getSelectedText,
  getTableContext,
  deleteTable as pmDeleteTable,
} from '@eigenpal/docx-editor-core/prosemirror';
import type { useTableSelection } from '../../../hooks/useTableSelection';
import type { useFindReplace } from '../../../hooks/useFindReplace';
import type { useHyperlinkDialog } from '../../dialogs/HyperlinkDialog';
import type { PagedEditorRef } from '../PagedEditor';

/**
 * Top-level keyboard shortcuts:
 *  - Cmd/Ctrl+F → open Find dialog (seeded with current selection)
 *  - Cmd/Ctrl+H → open Find/Replace dialog
 *  - Cmd/Ctrl+K → open Hyperlink dialog (edit if cursor sits on a link)
 *  - Delete/Backspace on a full-table layout selection → delete the table
 *
 * Listens on `document` so the shortcut works even when focus isn't in the
 * editor. `disableFindReplaceShortcuts` lets the host app reclaim Cmd+F /
 * Cmd+H when the editor is embedded inside another shell.
 */
export function useKeyboardShortcuts({
  pagedEditorRef,
  disableFindReplaceShortcuts,
  findReplace,
  hyperlinkDialog,
  tableSelection,
}: {
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  disableFindReplaceShortcuts: boolean;
  findReplace: ReturnType<typeof useFindReplace>;
  hyperlinkDialog: ReturnType<typeof useHyperlinkDialog>;
  tableSelection: ReturnType<typeof useTableSelection>;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Delete a layout-selected table (the non-ProseMirror selection in the
      // pages overlay) or a full ProseMirror CellSelection covering all cells.
      if (!cmdOrCtrl && !e.shiftKey && !e.altKey) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const view = pagedEditorRef.current?.getView();
          if (view) {
            const sel = view.state.selection as { $anchorCell?: unknown; forEachCell?: unknown };
            const isCellSel = '$anchorCell' in sel && typeof sel.forEachCell === 'function';
            if (isCellSel) {
              const context = getTableContext(view.state);
              if (context.isInTable && context.table) {
                let totalCells = 0;
                context.table.descendants((node) => {
                  if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
                    totalCells += 1;
                  }
                });
                let selectedCells = 0;
                (sel as { forEachCell: (fn: () => void) => void }).forEachCell(() => {
                  selectedCells += 1;
                });
                if (totalCells > 0 && selectedCells >= totalCells) {
                  e.preventDefault();
                  pmDeleteTable(view.state, view.dispatch);
                  return;
                }
              }
            }
          }

          if (tableSelection.state.tableIndex !== null) {
            e.preventDefault();
            tableSelection.handleAction('deleteTable');
            return;
          }
        }
      }

      if (cmdOrCtrl && !e.shiftKey && !e.altKey) {
        if (e.key.toLowerCase() === 'f') {
          if (disableFindReplaceShortcuts) return;
          e.preventDefault();
          const selection = window.getSelection();
          const selectedText = selection && !selection.isCollapsed ? selection.toString() : '';
          findReplace.openFind(selectedText);
        } else if (e.key.toLowerCase() === 'h') {
          if (disableFindReplaceShortcuts) return;
          e.preventDefault();
          const selection = window.getSelection();
          const selectedText = selection && !selection.isCollapsed ? selection.toString() : '';
          findReplace.openReplace(selectedText);
        } else if (e.key.toLowerCase() === 'k') {
          e.preventDefault();
          const view = pagedEditorRef.current?.getView();
          if (view) {
            const selectedText = getSelectedText(view.state);
            const existingLink = getHyperlinkAttrs(view.state);
            if (existingLink) {
              hyperlinkDialog.openEdit({
                url: existingLink.href,
                displayText: selectedText,
                tooltip: existingLink.tooltip,
              });
            } else {
              hyperlinkDialog.openInsert(selectedText);
            }
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [pagedEditorRef, disableFindReplaceShortcuts, findReplace, hyperlinkDialog, tableSelection]);
}
