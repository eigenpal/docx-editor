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
  generateTOC,
  insertTable,
} from '@eigenpal/docx-editor-core/prosemirror/commands';
import { createStyleResolver } from '@eigenpal/docx-editor-core/prosemirror';
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
}) {
  const handleFormat = useCallback(
    (action: FormattingAction) => {
      const view = getActiveEditorView();
      if (!view) return;

      // Focus editor first to ensure we can dispatch commands
      view.focus();

      // Selection restoration: dropdown clicks (font picker, style picker, etc.)
      // can move focus to the dropdown portal and collapse the body selection.
      // Restore the saved selection so the action lands on the user's intended
      // range. Only the body editor needs this — the HF editor manages its own.
      const isBodyEditor = view === pagedEditorRef.current?.getView();
      const { from, to } = view.state.selection;
      const savedSelection = lastSelectionRef.current;

      if (
        isBodyEditor &&
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

  const handleInsertTOC = useCallback(() => {
    const view = getActiveEditorView();
    if (!view) return;
    generateTOC(view.state, view.dispatch);
    focusActiveEditor();
  }, [getActiveEditorView, focusActiveEditor]);

  return {
    handleFormat,
    handleInsertTable,
    handleInsertPageBreak,
    handleInsertTOC,
  };
}
