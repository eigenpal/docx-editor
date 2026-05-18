/**
 * Formatting/style composable — handles paragraph-style application,
 * the `applyFormatting` ref-API entry point that maps an agent's mark
 * toggle request to a PM transaction, page break insertion, symbol
 * insertion, and clear-formatting.
 */

import type { Ref } from 'vue';
import type { EditorView } from 'prosemirror-view';
import { TextSelection } from 'prosemirror-state';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import { applyStyle } from '@eigenpal/docx-editor-core/prosemirror/commands/paragraph';
import { createStyleResolver } from '@eigenpal/docx-editor-core/prosemirror/styles';
import { clearFormatting } from '@eigenpal/docx-editor-core/prosemirror/commands/formatting';
import { insertPageBreak } from '@eigenpal/docx-editor-core/prosemirror/commands/pageBreak';
import { mapHexToHighlightName } from '@eigenpal/docx-editor-core/utils/highlightColors';
import { pointsToHalfPoints } from '@eigenpal/docx-editor-core/utils/units';
import { findParaIdRange, findTextInPmParagraph } from '../utils/paraTextHelpers';

export interface UseFormattingActionsOptions {
  editorView: Ref<EditorView | null>;
  getDocument: () => Document | null;
}

export interface ApplyFormattingOptions {
  paraId: string;
  search?: string;
  marks: {
    bold?: boolean;
    italic?: boolean;
    underline?: boolean | { style?: string };
    strike?: boolean;
    color?: { rgb?: string; themeColor?: string };
    highlight?: string;
    fontSize?: number;
    fontFamily?: { ascii?: string; hAnsi?: string };
  };
}

export function useFormattingActions(opts: UseFormattingActionsOptions) {
  function handleClearFormatting() {
    const view = opts.editorView.value;
    if (!view) return;
    clearFormatting(view.state, view.dispatch, view);
    view.focus();
  }

  function handleApplyStyle(styleId: string) {
    const view = opts.editorView.value;
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
    const view = opts.editorView.value;
    if (!view) return;
    const { from } = view.state.selection;
    const tr = view.state.tr.insertText(symbol, from);
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  function applyFormatting(options: ApplyFormattingOptions): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    const range = findParaIdRange(view.state.doc, options.paraId);
    if (!range) return false;

    let from = range.from + 1;
    let to = range.to - 1;
    if (options.search) {
      const textRange = findTextInPmParagraph(view.state.doc, range.from, range.to, options.search);
      if (!textRange) return false;
      from = textRange.from;
      to = textRange.to;
    }
    if (from >= to) return true;

    const { schema } = view.state;
    const marks = options.marks;
    let tr = view.state.tr;

    if (marks.bold !== undefined && schema.marks.bold) {
      tr = marks.bold
        ? tr.addMark(from, to, schema.marks.bold.create())
        : tr.removeMark(from, to, schema.marks.bold);
    }
    if (marks.italic !== undefined && schema.marks.italic) {
      tr = marks.italic
        ? tr.addMark(from, to, schema.marks.italic.create())
        : tr.removeMark(from, to, schema.marks.italic);
    }
    if (marks.underline !== undefined && schema.marks.underline) {
      if (marks.underline) {
        const style = typeof marks.underline === 'object' ? marks.underline.style : undefined;
        tr = tr.addMark(from, to, schema.marks.underline.create({ style: style ?? 'single' }));
      } else {
        tr = tr.removeMark(from, to, schema.marks.underline);
      }
    }
    if (marks.strike !== undefined && schema.marks.strike) {
      tr = marks.strike
        ? tr.addMark(from, to, schema.marks.strike.create())
        : tr.removeMark(from, to, schema.marks.strike);
    }
    if (marks.color !== undefined && schema.marks.textColor) {
      if (marks.color && (marks.color.rgb || marks.color.themeColor)) {
        tr = tr.addMark(
          from,
          to,
          schema.marks.textColor.create({
            rgb: marks.color.rgb ?? null,
            themeColor: marks.color.themeColor ?? null,
          })
        );
      } else {
        tr = tr.removeMark(from, to, schema.marks.textColor);
      }
    }
    if (marks.highlight !== undefined && schema.marks.highlight) {
      if (marks.highlight) {
        tr = tr.addMark(
          from,
          to,
          schema.marks.highlight.create({
            color: mapHexToHighlightName(marks.highlight) || marks.highlight,
          })
        );
      } else {
        tr = tr.removeMark(from, to, schema.marks.highlight);
      }
    }
    if (marks.fontSize !== undefined && schema.marks.fontSize) {
      tr =
        marks.fontSize > 0
          ? tr.addMark(
              from,
              to,
              schema.marks.fontSize.create({ size: pointsToHalfPoints(marks.fontSize) })
            )
          : tr.removeMark(from, to, schema.marks.fontSize);
    }
    if (marks.fontFamily !== undefined && schema.marks.fontFamily) {
      if (marks.fontFamily && (marks.fontFamily.ascii || marks.fontFamily.hAnsi)) {
        tr = tr.addMark(
          from,
          to,
          schema.marks.fontFamily.create({
            ascii: marks.fontFamily.ascii ?? null,
            hAnsi: marks.fontFamily.hAnsi ?? marks.fontFamily.ascii ?? null,
          })
        );
      } else {
        tr = tr.removeMark(from, to, schema.marks.fontFamily);
      }
    }

    view.dispatch(tr);
    return true;
  }

  function setParagraphStyle(options: { paraId: string; styleId: string }): boolean {
    const view = opts.editorView.value;
    if (!view) return false;
    const range = findParaIdRange(view.state.doc, options.paraId);
    if (!range) return false;

    const doc = opts.getDocument();
    const styleResolver = doc?.package?.styles ? createStyleResolver(doc.package.styles) : null;
    if (styleResolver && !styleResolver.hasParagraphStyle(options.styleId)) return false;

    const $from = view.state.doc.resolve(range.from + 1);
    const $to = view.state.doc.resolve(range.to - 1);
    const stateWithSelection = view.state.apply(
      view.state.tr.setSelection(TextSelection.between($from, $to))
    );
    const command = styleResolver
      ? (() => {
          const resolved = styleResolver.resolveParagraphStyle(options.styleId);
          return applyStyle(options.styleId, {
            paragraphFormatting: resolved.paragraphFormatting,
            runFormatting: resolved.runFormatting,
          });
        })()
      : applyStyle(options.styleId);

    let didApply = false;
    command(stateWithSelection, (transaction) => {
      didApply = true;
      transaction.setSelection(view.state.selection.map(transaction.doc, transaction.mapping));
      view.dispatch(transaction);
    });
    return didApply;
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
