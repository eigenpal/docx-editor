import { useEffect } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import type { useFindReplace } from '../../../hooks/useFindReplace';
import type { useHyperlinkDialog } from '../../dialogs/HyperlinkDialog';

/**
 * Top-level keyboard shortcuts:
 *  - Cmd/Ctrl+O → open the DOCX picker when File > Open is enabled
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
  editorRef,
  disableFindReplaceShortcuts,
  showFileOpen,
  onOpenDocument,
  findReplace,
  hyperlinkDialog,
}: {
  editorRef: React.RefObject<Editor | null>;
  disableFindReplaceShortcuts: boolean;
  showFileOpen: boolean;
  onOpenDocument?: () => void;
  findReplace: ReturnType<typeof useFindReplace>;
  hyperlinkDialog: ReturnType<typeof useHyperlinkDialog>;
}) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      // Delete the selected table. Legacy had two paths here — a ProseMirror
      // CellSelection covering every cell, and the pages overlay's own table selection —
      // and counted cells to tell "whole table" from "some cells". The engine answers
      // that question directly: `getSelectedTable` is the table the selection is in, and
      // `deleteTable` is refused when it does not apply, so no cell counting is needed.
      if (!cmdOrCtrl && !e.shiftKey && !e.altKey) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const editor = editorRef.current;
          if (editor?.getSelectedTable() && editor.can({ type: 'deleteTable' }).ok) {
            e.preventDefault();
            editor.exec({ type: 'deleteTable' });
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
        } else if (e.key.toLowerCase() === 'o') {
          if (!showFileOpen || !onOpenDocument) return;
          e.preventDefault();
          onOpenDocument();
        } else if (e.key.toLowerCase() === 'h') {
          if (disableFindReplaceShortcuts) return;
          e.preventDefault();
          const selection = window.getSelection();
          const selectedText = selection && !selection.isCollapsed ? selection.toString() : '';
          findReplace.openReplace(selectedText);
        } else if (e.key.toLowerCase() === 'k') {
          e.preventDefault();
          const editor = editorRef.current;
          if (editor) {
            // Legacy read both off the editing engine's state; the same two questions
            // are on the contract as queries.
            const selectedText = editor.query({ type: 'selectedText' });
            const existingLink = editor.query({ type: 'hyperlinkAt' });
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
  }, [
    editorRef,
    disableFindReplaceShortcuts,
    showFileOpen,
    onOpenDocument,
    findReplace,
    hyperlinkDialog,
  ]);
}
