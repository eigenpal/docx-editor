/**
 * Toolbar formatting and insert actions.
 *
 * PORTED from the legacy hook of the same name, with every dispatch moved onto the
 * `Editor` contract. The action vocabulary, the branch order, and the exported handler
 * names are legacy's — the toolbar passes the same `FormattingAction` values it always
 * did, so nothing in the ported chrome changes.
 *
 * Two things legacy did that have no counterpart here, and why:
 *
 *  - SELECTION RESTORATION. Legacy saved and restored the ProseMirror selection around
 *    every action, because a dropdown click could move focus to a portal and collapse
 *    the body selection. The engine holds the selection in its interaction frame rather
 *    than in the DOM, so an adapter focus change does not collapse it and there is
 *    nothing to restore.
 *  - TOOLBAR RESYNC. Legacy pushed toolbar state from the live view with `flushSync`
 *    after each action so `aria-pressed` would not lag paint. The engine emits
 *    `selectionChange`, which the adapter already listens to, so the toolbar re-reads
 *    `getSelectionFormatting` on its own.
 *
 * What actually applies today is what the engine implements: `toggleMark` for bold and
 * italic. Everything else — underline (deliberately refused: `w:u` carries a style, so a
 * boolean would downgrade the author's formatting on save), colours, font, size, spacing,
 * styles, lists, indent, breaks, tables — returns an unsupported result, so the button
 * does nothing rather than something unintended.
 */
import { useCallback } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import type { ColorValue } from '@docx-editor.dev/core-contract/types';
import type { FormattingAction } from '../../Toolbar';
import type { useHyperlinkDialog } from '../../dialogs/HyperlinkDialog';

export function useFormattingActions({
  editorRef,
  focusActiveEditor,
  hyperlinkDialog,
  onTableOfContentsInserted,
}: {
  editorRef: React.RefObject<Editor | null>;
  focusActiveEditor: () => void;
  hyperlinkDialog: ReturnType<typeof useHyperlinkDialog>;
  onTableOfContentsInserted?: () => void;
}) {
  const handleFormat = useCallback(
    (action: FormattingAction) => {
      const editor = editorRef.current;
      if (!editor) return;
      focusActiveEditor();

      // Selection-targeted commands need a `DocTarget`. `query({ type: 'selection' })` is
      // part of the unwired query surface and answers null today, so those branches do
      // not run — the honest empty answer flowing through, not a guessed range. The
      // toggles below need no target and apply for real.
      const target = () => editor.query({ type: 'selection' }) ?? undefined;

      if (action === 'bold') editor.exec({ type: 'toggleMark', mark: 'bold' });
      else if (action === 'italic') editor.exec({ type: 'toggleMark', mark: 'italic' });
      else if (action === 'underline') editor.exec({ type: 'toggleMark', mark: 'underline' });
      else if (action === 'strikethrough') editor.exec({ type: 'toggleMark', mark: 'strike' });
      else if (action === 'superscript') editor.exec({ type: 'toggleMark', mark: 'superscript' });
      else if (action === 'subscript') editor.exec({ type: 'toggleMark', mark: 'subscript' });
      else if (action === 'bulletList') editor.exec({ type: 'toggleList', kind: 'bullet' });
      else if (action === 'numberedList') editor.exec({ type: 'toggleList', kind: 'ordered' });
      else if (action === 'indent') editor.exec({ type: 'setIndent', left: 720 });
      else if (action === 'outdent') editor.exec({ type: 'setIndent', left: -720 });
      else if (action === 'clearFormatting') {
        // Legacy cleared every mark and paragraph property in one command. There is no
        // clear-formatting command on the contract, and toggling marks off one by one
        // would leave everything the model does not represent untouched — which reads as
        // "clear formatting did nothing to my fonts". Left to the capability.
      } else if (action === 'setRtl' || action === 'setLtr') {
        // Paragraph direction is not on the command surface yet.
      } else if (action === 'insertLink') {
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
        return;
      } else if (typeof action === 'object') {
        switch (action.type) {
          case 'alignment': {
            // Legacy's alignment vocabulary is OOXML's (`both`, `distribute`, the Kashida
            // variants); the command takes the four the engine models. `both` is
            // justified under a different name; the rest have no command and are left
            // alone rather than approximated by one that looks close.
            const align =
              action.value === 'both'
                ? ('justify' as const)
                : action.value === 'left' || action.value === 'center' || action.value === 'right'
                  ? action.value
                  : null;
            if (align) editor.exec({ type: 'setAlignment', align });
            break;
          }
          case 'textColor': {
            const colorVal = action.value;
            // Legacy's colour is the OOXML record (`rgb`, `themeColor` + tint/shade,
            // `auto`); the contract's is a tagged union. Mapped explicitly rather than
            // passed through, because the two disagree on shape and a cast would compile
            // while sending the engine a value it cannot read.
            const color: ColorValue | undefined =
              typeof colorVal === 'string'
                ? { kind: 'hex', value: colorVal.replace('#', '') }
                : colorVal.auto
                  ? { kind: 'auto' }
                  : colorVal.themeColor
                    ? {
                        kind: 'theme',
                        slot: colorVal.themeColor,
                        // Legacy carries tint/shade as hex strings (`"80"`); the contract
                        // takes numbers.
                        ...(colorVal.themeTint ? { tint: parseInt(colorVal.themeTint, 16) } : {}),
                        ...(colorVal.themeShade ? { shade: parseInt(colorVal.themeShade, 16) } : {}),
                      }
                    : colorVal.rgb
                      ? { kind: 'hex', value: colorVal.rgb }
                      : undefined;
            const range = target();
            if (range && color) {
              editor.exec({ type: 'applyFormatting', target: range, marks: { color } });
            }
            break;
          }
          case 'highlightColor': {
            const range = target();
            if (range) {
              editor.exec({
                type: 'applyFormatting',
                target: range,
                marks: { highlight: action.value },
              });
            }
            break;
          }
          case 'fontSize': {
            const range = target();
            // `RunFormatting` carries POINTS, where legacy's command took half-points;
            // the picker's value is already in points, so no conversion is needed here.
            if (range) {
              editor.exec({
                type: 'applyFormatting',
                target: range,
                marks: { fontSizePt: action.value },
              });
            }
            break;
          }
          case 'fontFamily': {
            const range = target();
            if (range) {
              editor.exec({
                type: 'applyFormatting',
                target: range,
                marks: { fontFamily: action.value },
              });
            }
            break;
          }
          case 'lineSpacing':
            // No line-spacing command on the contract; `w:spacing` is paragraph
            // property territory the command surface does not cover yet.
            break;
          case 'applyStyle': {
            const range = target();
            if (range) {
              editor.exec({ type: 'setParagraphStyle', target: range, styleId: action.value });
            }
            break;
          }
        }
      }
    },
    [editorRef, focusActiveEditor, hyperlinkDialog]
  );

  const handleInsertTable = useCallback(
    (rows: number, columns: number) => {
      editorRef.current?.exec({ type: 'insertTable', rows, cols: columns });
      focusActiveEditor();
    },
    [editorRef, focusActiveEditor]
  );

  const handleInsertPageBreak = useCallback(() => {
    editorRef.current?.exec({ type: 'insertBreak', kind: 'page' });
    focusActiveEditor();
  }, [editorRef, focusActiveEditor]);

  const handleInsertSectionBreakNextPage = useCallback(() => {
    // The contract has one `section` break kind; legacy distinguished next-page from
    // continuous, which is a section-property difference the command does not carry yet.
    editorRef.current?.exec({ type: 'insertBreak', kind: 'section' });
    focusActiveEditor();
  }, [editorRef, focusActiveEditor]);

  const handleInsertSectionBreakContinuous = useCallback(() => {
    editorRef.current?.exec({ type: 'insertBreak', kind: 'section' });
    focusActiveEditor();
  }, [editorRef, focusActiveEditor]);

  const handleInsertTOC = useCallback(() => {
    // `refreshToc` rebuilds an existing TOC; there is no insert-TOC command, so this
    // asks for the refresh and the engine reports whether anything happened.
    editorRef.current?.exec({ type: 'refreshToc' });
    onTableOfContentsInserted?.();
    focusActiveEditor();
  }, [editorRef, focusActiveEditor, onTableOfContentsInserted]);

  return {
    handleFormat,
    handleInsertTable,
    handleInsertPageBreak,
    handleInsertSectionBreakNextPage,
    handleInsertSectionBreakContinuous,
    handleInsertTOC,
  };
}
