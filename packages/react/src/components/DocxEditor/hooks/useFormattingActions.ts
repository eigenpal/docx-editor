import { useCallback } from 'react';
import { TextSelection } from 'prosemirror-state';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import {
  toggleBold,
  toggleItalic,
  toggleUnderline,
  toggleStrike,
  toggleSuperscript,
  toggleSubscript,
  setTextColor,
  clearTextColor,
  setHighlight,
  setFontSize,
  setFontFamily,
  setAlignment,
  setLineSpacing,
  toggleBulletList,
  toggleNumberedList,
  increaseIndent,
  decreaseIndent,
  increaseListLevel,
  decreaseListLevel,
  clearFormatting,
  applyStyle,
  getHyperlinkAttrs,
  getSelectedText,
  setRtl,
  setLtr,
  insertPageBreak,
  insertSectionBreakNextPage,
  insertSectionBreakContinuous,
  insertTable,
} from '@eigenpal/docx-editor-core/prosemirror/commands';
import { createStyleResolver, insertTableOfContents } from '@eigenpal/docx-editor-core/prosemirror';
import { getCachedNumberingMap } from '@eigenpal/docx-editor-core/docx';
import type { EditorView } from 'prosemirror-view';
import type { FormattingAction } from '../../Toolbar';
import { pointsToHalfPoints } from '../../ui/FontSizePicker';
import { mapHexToHighlightName } from '../../toolbarUtils';
import type { useHyperlinkDialog } from '../../dialogs/HyperlinkDialog';
import type { PagedEditorRef } from '../PagedEditor';

/**
 * Toolbar action handlers: the big `handleFormat` switch that routes
 * every toolbar press to its ProseMirror command (bold/italic, colors,
 * alignment, lists, indents, styles, RTL/LTR, link, etc.) plus the
 * insertTable / insertPageBreak / insertTOC dispatchers.
 */
export function useFormattingActions({
  getActiveEditorView,
  focusActiveEditor,
  pagedEditorRef,
  lastSelectionRef,
  hyperlinkDialog,
  historyStateRef,
  getCachedStyleResolver,
  onTableOfContentsInserted,
}: {
  getActiveEditorView: () => EditorView | null | undefined;
  focusActiveEditor: () => void;
  pagedEditorRef: React.RefObject<PagedEditorRef | null>;
  lastSelectionRef: React.RefObject<{ from: number; to: number } | null>;
  hyperlinkDialog: ReturnType<typeof useHyperlinkDialog>;
  historyStateRef: React.RefObject<Document | null>;
  getCachedStyleResolver: (
    styles: Parameters<typeof createStyleResolver>[0]
  ) => ReturnType<typeof createStyleResolver>;
  onTableOfContentsInserted?: () => void;
}) {
  const handleFormat = useCallback(
    (action: FormattingAction) => {
      const view = getActiveEditorView();
      if (!view) return;

      // Capture focus + selection BEFORE view.focus(). Toolbar buttons
      // preventDefault mousedown so the hidden PM keeps focus; in that case the
      // live selection is authoritative. Dropdown portals steal focus and often
      // leave a collapsed/stale PM selection — only then restore lastSelectionRef.
      // Restoring while focused overwrites the caret after typing when the
      // selection-tracker ref lags behind (cursor jumps to the prior mark site).
      const hadFocus = view.hasFocus();
      const { from, to } = view.state.selection;
      const savedSelection = lastSelectionRef.current;

      // Focus editor first to ensure we can dispatch commands
      view.focus();

      const isBodyEditor = view === pagedEditorRef.current?.getView();

      if (
        isBodyEditor &&
        !hadFocus &&
        savedSelection &&
        (from !== savedSelection.from || to !== savedSelection.to)
      ) {
        try {
          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.doc, savedSelection.from, savedSelection.to)
          );
          view.dispatch(tr);
        } catch (e) {
          console.warn('Could not restore selection:', e);
        }
      } else if (isBodyEditor) {
        // Keep the ref aligned with the live caret so a later focus-stealing
        // toolbar control still restores the right range.
        lastSelectionRef.current = { from, to };
      }

      if (action === 'bold') return void toggleBold(view.state, view.dispatch);
      if (action === 'italic') return void toggleItalic(view.state, view.dispatch);
      if (action === 'underline') return void toggleUnderline(view.state, view.dispatch);
      if (action === 'strikethrough') return void toggleStrike(view.state, view.dispatch);
      if (action === 'superscript') return void toggleSuperscript(view.state, view.dispatch);
      if (action === 'subscript') return void toggleSubscript(view.state, view.dispatch);
      if (action === 'bulletList') return void toggleBulletList(view.state, view.dispatch);
      if (action === 'numberedList') return void toggleNumberedList(view.state, view.dispatch);
      if (action === 'indent') {
        if (!increaseListLevel(view.state, view.dispatch)) {
          increaseIndent()(view.state, view.dispatch);
        }
        return;
      }
      if (action === 'outdent') {
        if (!decreaseListLevel(view.state, view.dispatch)) {
          decreaseIndent()(view.state, view.dispatch);
        }
        return;
      }
      if (action === 'clearFormatting') return void clearFormatting(view.state, view.dispatch);
      if (action === 'setRtl') return void setRtl(view.state, view.dispatch);
      if (action === 'setLtr') return void setLtr(view.state, view.dispatch);
      if (action === 'insertLink') {
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
        return;
      }

      if (typeof action === 'object') {
        switch (action.type) {
          case 'alignment':
            setAlignment(action.value)(view.state, view.dispatch);
            break;
          case 'textColor': {
            const colorVal = action.value;
            if (typeof colorVal === 'string') {
              setTextColor({ rgb: colorVal.replace('#', '') })(view.state, view.dispatch);
            } else if (colorVal.auto) {
              clearTextColor(view.state, view.dispatch);
            } else {
              setTextColor(colorVal)(view.state, view.dispatch);
            }
            break;
          }
          case 'highlightColor': {
            // Convert hex to OOXML named highlight value (e.g., 'FFFF00' → 'yellow')
            const highlightName = action.value ? mapHexToHighlightName(action.value) : '';
            setHighlight(highlightName || action.value)(view.state, view.dispatch);
            break;
          }
          case 'fontSize':
            // OOXML uses half-points for font sizes
            setFontSize(pointsToHalfPoints(action.value))(view.state, view.dispatch);
            break;
          case 'fontFamily':
            setFontFamily(action.value)(view.state, view.dispatch);
            break;
          case 'lineSpacing':
            setLineSpacing(action.value)(view.state, view.dispatch);
            break;
          case 'applyStyle': {
            // Read latest doc through ref to dodge stale closures.
            const currentDoc = historyStateRef.current;
            const styleResolver = currentDoc?.package.styles
              ? getCachedStyleResolver(currentDoc.package.styles)
              : null;

            if (styleResolver) {
              const resolved = styleResolver.resolveParagraphStyle(action.value);
              applyStyle(action.value, {
                paragraphFormatting: resolved.paragraphFormatting,
                runFormatting: resolved.runFormatting,
                numbering: currentDoc?.package.numbering
                  ? getCachedNumberingMap(currentDoc.package.numbering)
                  : null,
              })(view.state, view.dispatch);
            } else {
              applyStyle(action.value)(view.state, view.dispatch);
            }
            break;
          }
        }
      }
    },
    [
      getActiveEditorView,
      pagedEditorRef,
      lastSelectionRef,
      hyperlinkDialog,
      historyStateRef,
      getCachedStyleResolver,
    ]
  );

  const handleInsertTable = useCallback(
    (rows: number, columns: number) => {
      const view = getActiveEditorView();
      if (!view) return;
      insertTable(rows, columns)(view.state, view.dispatch);
      focusActiveEditor();
    },
    [getActiveEditorView, focusActiveEditor]
  );

  const handleInsertPageBreak = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    insertPageBreak(view.state, view.dispatch);
    focusActiveEditor();
  }, [getActiveEditorView, focusActiveEditor]);

  const handleInsertSectionBreakNextPage = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    insertSectionBreakNextPage(view.state, view.dispatch);
    focusActiveEditor();
  }, [getActiveEditorView, focusActiveEditor]);

  const handleInsertSectionBreakContinuous = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    insertSectionBreakContinuous(view.state, view.dispatch);
    focusActiveEditor();
  }, [getActiveEditorView, focusActiveEditor]);

  const handleInsertTOC = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    insertTableOfContents(view.state, view.dispatch);
    onTableOfContentsInserted?.();
    focusActiveEditor();
  }, [getActiveEditorView, focusActiveEditor, onTableOfContentsInserted]);

  return {
    handleFormat,
    handleInsertTable,
    handleInsertPageBreak,
    handleInsertSectionBreakNextPage,
    handleInsertSectionBreakContinuous,
    handleInsertTOC,
  };
}
