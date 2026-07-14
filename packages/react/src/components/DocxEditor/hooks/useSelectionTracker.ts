import { useCallback } from 'react';
import type { Theme, TabMark } from '@eigenpal/docx-editor-core/types/document';
import {
  getTableContext,
  type SelectionState,
  type TableContextInfo,
  createStyleResolver,
} from '@eigenpal/docx-editor-core/prosemirror';
import { resolveColorToHex } from '@eigenpal/docx-editor-core/utils';
import type { EditorView } from 'prosemirror-view';
import type { SelectionFormatting } from '../../Toolbar';

interface PmImageContext {
  pos: number;
  wrapType: string;
  displayMode: string;
  cssFloat: string | null;
  transform: string | null;
  alt: string | null;
  borderWidth: number | null;
  borderColor: string | null;
  borderKind: string | null;
  width: number | null;
  height: number | null;
}

interface BorderSpec {
  style: string;
  size: number;
  color: { rgb: string };
}

/** Slice of EditorState that handleSelectionChange writes on every fire. */
export interface SelectionStateDelta {
  selectionFormatting?: SelectionFormatting;
  paragraphIndentLeft?: number;
  paragraphIndentRight?: number;
  paragraphFirstLineIndent?: number;
  paragraphHangingIndent?: boolean;
  paragraphTabs?: TabMark[] | null;
  /** Omit when the editor view is briefly unavailable so prior context is kept. */
  pmTableContext?: TableContextInfo | null;
  pmImageContext?: PmImageContext | null;
}

/**
 * Selection-change handler: extracts the formatting state ProseMirror
 * sees at the cursor, derives table + image context from the PM
 * selection, syncs the border-spec ref to the cell's actual color,
 * pushes the result into EditorState, refreshes the floating
 * add-comment button, and fans the SelectionState out to consumer-side
 * `onSelectionChange` + the bridge subscribers.
 *
 * Font/size fall back to the paragraph style's resolved values when no
 * explicit run-level mark is present — keeps the toolbar picker showing
 * the right value for unstyled cursor positions.
 */
export function useSelectionTracker({
  getActiveEditorView,
  lastSelectionRef,
  borderSpecRef,
  theme,
  historyStateRef,
  getCachedStyleResolver,
  setFloatingCommentBtn,
  applySelectionDelta,
  recomputeFloatingCommentBtn,
  onSelectionChange,
  selectionChangeSubscribersRef,
}: {
  getActiveEditorView: () => EditorView | null | undefined;
  lastSelectionRef: React.RefObject<{ from: number; to: number } | null>;
  borderSpecRef: React.RefObject<BorderSpec>;
  theme: Theme | null | undefined;
  historyStateRef: React.RefObject<{ package: { styles?: unknown } } | null>;
  getCachedStyleResolver: (
    styles: Parameters<typeof createStyleResolver>[0]
  ) => ReturnType<typeof createStyleResolver>;
  setFloatingCommentBtn: React.Dispatch<React.SetStateAction<{ top: number; left: number } | null>>;
  applySelectionDelta: (delta: SelectionStateDelta) => void;
  recomputeFloatingCommentBtn: () => void;
  onSelectionChange: ((state: SelectionState | null) => void) | undefined;
  selectionChangeSubscribersRef: React.RefObject<Set<(s: SelectionState | null) => void>>;
}) {
  const handleSelectionChange = useCallback(
    (selectionState: SelectionState | null) => {
      const view = getActiveEditorView();
      if (view) {
        const { from, to } = view.state.selection;
        lastSelectionRef.current = { from, to };
      }

      // When the view is briefly unavailable (layout teardown mid-transaction),
      // omit table/image context from the delta so we don't clobber a still-
      // valid in-table toolbar state with null.
      let pmTableCtx: TableContextInfo | null | undefined;
      if (view) {
        const ctx = getTableContext(view.state);
        pmTableCtx = ctx.isInTable ? ctx : null;
      }

      // Sync borderSpecRef with the current cell's actual border color so
      // the toolbar's color/width pickers reflect the active cell.
      if (pmTableCtx?.cellBorderColor) {
        const rgb = resolveColorToHex(pmTableCtx.cellBorderColor, theme ?? undefined);
        if (rgb) {
          borderSpecRef.current = { ...borderSpecRef.current, color: { rgb } };
        }
      }

      // Detect a NodeSelection on an image (right-click + click-to-select).
      let pmImageCtx: PmImageContext | null | undefined;
      if (view) {
        pmImageCtx = null;
        const sel = view.state.selection;
        const selectedNode = (
          sel as { node?: { type: { name: string }; attrs: Record<string, unknown> } }
        ).node;
        if (selectedNode?.type.name === 'image') {
          pmImageCtx = {
            pos: sel.from,
            wrapType: (selectedNode.attrs.wrapType as string) ?? 'inline',
            displayMode: (selectedNode.attrs.displayMode as string) ?? 'inline',
            cssFloat: (selectedNode.attrs.cssFloat as string) ?? null,
            transform: (selectedNode.attrs.transform as string) ?? null,
            alt: (selectedNode.attrs.alt as string) ?? null,
            borderWidth: (selectedNode.attrs.borderWidth as number) ?? null,
            borderColor: (selectedNode.attrs.borderColor as string) ?? null,
            borderKind: (selectedNode.attrs.borderKind as string) ?? null,
            width: (selectedNode.attrs.width as number) ?? null,
            height: (selectedNode.attrs.height as number) ?? null,
          };
        }
      }

      if (!selectionState) {
        setFloatingCommentBtn(null);
        applySelectionDelta({
          selectionFormatting: {},
          ...(pmTableCtx !== undefined ? { pmTableContext: pmTableCtx } : {}),
          ...(pmImageCtx !== undefined ? { pmImageContext: pmImageCtx } : {}),
        });
        return;
      }

      const { textFormatting, paragraphFormatting } = selectionState;

      // Font/size fall back to the paragraph style's resolved values when no
      // explicit run-level mark is present.
      let fontFamily = textFormatting.fontFamily?.ascii || textFormatting.fontFamily?.hAnsi;
      let fontSize = textFormatting.fontSize;
      if (!fontFamily || !fontSize) {
        const currentDoc = historyStateRef.current;
        const paraStyleId = selectionState.styleId;
        if (currentDoc?.package.styles && paraStyleId) {
          const resolver = getCachedStyleResolver(
            currentDoc.package.styles as Parameters<typeof createStyleResolver>[0]
          );
          const resolved = resolver.resolveParagraphStyle(paraStyleId);
          if (!fontFamily && resolved.runFormatting?.fontFamily) {
            fontFamily =
              resolved.runFormatting.fontFamily.ascii || resolved.runFormatting.fontFamily.hAnsi;
          }
          if (!fontSize && resolved.runFormatting?.fontSize) {
            fontSize = resolved.runFormatting.fontSize;
          }
        }
      }

      const textColorHex = resolveColorToHex(textFormatting.color, theme ?? undefined);
      const textColor = textColorHex ? `#${textColorHex}` : undefined;

      // Build list state from numPr.
      const numPr = paragraphFormatting.numPr;
      const listState = numPr
        ? {
            type: (numPr.numId === 1 ? 'bullet' : 'numbered') as 'bullet' | 'numbered',
            level: numPr.ilvl ?? 0,
            isInList: true,
            numId: numPr.numId,
          }
        : undefined;

      const formatting: SelectionFormatting = {
        bold: textFormatting.bold,
        italic: textFormatting.italic,
        underline: !!textFormatting.underline,
        strike: textFormatting.strike,
        superscript: textFormatting.vertAlign === 'superscript',
        subscript: textFormatting.vertAlign === 'subscript',
        fontFamily,
        fontSize,
        color: textColor,
        highlight: textFormatting.highlight,
        alignment: paragraphFormatting.alignment,
        lineSpacing: paragraphFormatting.lineSpacing,
        listState,
        styleId: selectionState.styleId ?? undefined,
        indentLeft: paragraphFormatting.indentLeft,
        bidi: !!paragraphFormatting.bidi,
      };

      applySelectionDelta({
        selectionFormatting: formatting,
        paragraphIndentLeft: paragraphFormatting.indentLeft ?? 0,
        paragraphIndentRight: paragraphFormatting.indentRight ?? 0,
        paragraphFirstLineIndent: paragraphFormatting.indentFirstLine ?? 0,
        paragraphHangingIndent: paragraphFormatting.hangingIndent ?? false,
        paragraphTabs: paragraphFormatting.tabs ?? null,
        ...(pmTableCtx !== undefined ? { pmTableContext: pmTableCtx } : {}),
        ...(pmImageCtx !== undefined ? { pmImageContext: pmImageCtx } : {}),
      });

      recomputeFloatingCommentBtn();

      onSelectionChange?.(selectionState);
      // Fan out to bridge subscribers.
      for (const cb of selectionChangeSubscribersRef.current) {
        try {
          cb(selectionState);
        } catch (e) {
          console.error('selectionChange subscriber threw:', e);
        }
      }
    },
    [
      getActiveEditorView,
      lastSelectionRef,
      borderSpecRef,
      theme,
      historyStateRef,
      getCachedStyleResolver,
      setFloatingCommentBtn,
      applySelectionDelta,
      recomputeFloatingCommentBtn,
      onSelectionChange,
      selectionChangeSubscribersRef,
    ]
  );

  return { handleSelectionChange };
}
