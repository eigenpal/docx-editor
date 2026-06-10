/**
 * Formatting/style composable — handles paragraph-style application,
 * the `applyFormatting` ref-API entry point that maps an agent's mark
 * toggle request to a PM transaction, page break insertion, symbol
 * insertion, and clear-formatting.
 */

import type { Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import { applyStyle } from '@eigenpal/docx-editor-core/prosemirror/commands/paragraph';
import { createStyleResolver } from '@eigenpal/docx-editor-core/prosemirror/styles';
import { clearFormatting } from '@eigenpal/docx-editor-core/prosemirror/commands/formatting';
import { insertPageBreak } from '@eigenpal/docx-editor-core/prosemirror/commands/pageBreak';
import {
  applyFormatting as applyFormattingCore,
  setParagraphStyle as setParagraphStyleCore,
  type ApplyFormattingOptions,
} from '@eigenpal/docx-editor-core/prosemirror/applyFormatting';

export interface UseFormattingActionsOptions {
  editorView: Ref<EditorView | null>;
  /**
   * The view interactive toolbar formatting should target. While a header or
   * footer is being edited this is its EditorView, so toolbar actions land in
   * the HF and not the body (#749). Falls back to the body `editorView`. The
   * agent ref-API (`applyFormatting`/`setParagraphStyle`, which resolve a
   * paraId in the body) deliberately keeps using `editorView`.
   */
  activeView?: Ref<EditorView | null>;
  getDocument: () => Document | null;
}

export type { ApplyFormattingOptions };

export function useFormattingActions(opts: UseFormattingActionsOptions) {
  const targetView = () => opts.activeView?.value ?? opts.editorView.value;

  function handleClearFormatting() {
    const view = targetView();
    if (!view) return;
    clearFormatting(view.state, view.dispatch, view);
    view.focus();
  }

  function handleApplyStyle(styleId: string) {
    const view = targetView();
    if (!view) return;
    const doc = opts.getDocument();
    const styles = doc?.package?.styles;
    if (styles) {
      const resolver = createStyleResolver(styles);
      const resolved = resolver.resolveParagraphStyle(styleId);
      applyStyle(styleId, {
        paragraphFormatting: resolved.paragraphFormatting,
        runFormatting: resolved.runFormatting,
      })(view.state, (tr) => view.dispatch(tr));
    } else {
      applyStyle(styleId)(view.state, (tr) => view.dispatch(tr));
    }
    view.focus();
  }

  function handleInsertPageBreak() {
    const view = opts.editorView.value;
    if (!view) return;
    insertPageBreak(view.state, (tr) => view.dispatch(tr), view);
    view.focus();
  }

  function handleInsertSymbol(symbol: string) {
    const view = targetView();
    if (!view) return;
    const { from } = view.state.selection;
    const tr = view.state.tr.insertText(symbol, from);
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  function applyFormatting(options: ApplyFormattingOptions): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    return applyFormattingCore(view, options);
  }

  function setParagraphStyle(options: { paraId: string; styleId: string }): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    const doc = opts.getDocument();
    const styleResolver = doc?.package?.styles ? createStyleResolver(doc.package.styles) : null;
    return setParagraphStyleCore(view, options, { styleResolver });
  }

  return {
    handleClearFormatting,
    handleApplyStyle,
    handleInsertPageBreak,
    handleInsertSymbol,
    applyFormatting,
    setParagraphStyle,
  };
}
