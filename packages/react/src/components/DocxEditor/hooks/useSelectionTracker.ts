/**
 * Selection tracking: what the toolbar shows for the current caret or range.
 *
 * PORTED from the legacy hook of the same name. Legacy read the formatting off the
 * editing engine's state at the cursor and derived table and image context from its
 * selection; here each of those is a capability, and the delta shape
 * (`SelectionStateDelta`) and the exported handler name are legacy's, so consumers are
 * unchanged.
 *
 * Legacy also fell back to the paragraph style's resolved font and size when no
 * run-level mark was present, "so the toolbar picker shows the right value for unstyled
 * cursor positions". `getSelectionFormatting` does that resolution inside the engine —
 * it reads the run's properties and its preserved `w:rPr` — so the fallback is not
 * repeated here.
 *
 * Fields with no capability behind them are OMITTED rather than defaulted: paragraph
 * indents and tab marks have no derivation yet, and emitting `0` for them would tell the
 * ruler the paragraph has no indent, which is a claim the engine cannot make.
 */
import { useCallback } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/editor';
import type { TableContextInfo } from '../../../legacy-core-compat';
import type { SelectionFormatting } from '../../Toolbar';

/** Slice of editor state that `handleSelectionChange` writes on every fire. */
export interface SelectionStateDelta {
  selectionFormatting?: SelectionFormatting;
  /** Omit when the engine cannot answer, so prior context is kept rather than cleared. */
  pmTableContext?: TableContextInfo | null;
  pmImageContext?: { id: string; widthEmu: number; heightEmu: number } | null;
}

export function useSelectionTracker({
  editorRef,
  applySelectionDelta,
}: {
  editorRef: React.RefObject<Editor | null>;
  applySelectionDelta: (delta: SelectionStateDelta) => void;
}) {
  const handleSelectionChange = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;

    const f = editor.getSelectionFormatting();
    const selectionFormatting: SelectionFormatting = {
      ...(f?.bold !== undefined ? { bold: f.bold } : {}),
      ...(f?.italic !== undefined ? { italic: f.italic } : {}),
      ...(f?.underline !== undefined ? { underline: f.underline } : {}),
      ...(f?.fontFamily ? { fontFamily: f.fontFamily } : {}),
      // `SelectionFormatting.fontSize` is in HALF-POINTS, which is what the engine
      // reports — the same OOXML unit, so no conversion.
      ...(f?.fontSizeHalfPoints ? { fontSize: f.fontSizeHalfPoints } : {}),
      ...(f?.styleId ? { styleId: f.styleId } : {}),
    };

    const table = editor.getSelectedTable();
    const image = editor.getSelectedImage();
    applySelectionDelta({
      selectionFormatting,
      pmTableContext: table
        ? {
            isInTable: true,
            rowCount: table.rowCount,
            columnCount: table.columnCount,
            hasMultiCellSelection: false,
            canSplitCell: false,
          }
        : null,
      pmImageContext: image
        ? { id: image.id, widthEmu: image.widthEmu, heightEmu: image.heightEmu }
        : null,
    });
  }, [editorRef, applySelectionDelta]);

  return { handleSelectionChange };
}
