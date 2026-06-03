import { useCallback, useState } from 'react';
import type { EditorView } from 'prosemirror-view';
import type { Watermark } from '@eigenpal/docx-editor-core/types/document';
import {
  setWatermark,
  getWatermarkFromState,
} from '@eigenpal/docx-editor-core/prosemirror/commands';

/**
 * Watermark dialog controls. The watermark is a `doc` attribute on the body
 * ProseMirror state, so applying/removing it is a normal undoable transaction
 * (toolbar undo/redo + Ctrl+Z work, the painter reads it from PM state, and the
 * conversion layer syncs it to `HeaderFooter.watermark` for save).
 */
export function useWatermarkControls({
  readOnly,
  getBodyEditorView,
}: {
  readOnly: boolean;
  getBodyEditorView: () => EditorView | null | undefined;
}) {
  const [showWatermark, setShowWatermark] = useState(false);
  const handleOpenWatermark = useCallback(() => setShowWatermark(true), []);

  // Read from the live body PM state so the dialog reflects the current value
  // (including after undo/redo).
  const view = getBodyEditorView();
  const currentWatermark = view ? (getWatermarkFromState(view.state) ?? undefined) : undefined;

  const handleWatermarkApply = useCallback(
    (watermark: Watermark | null) => {
      if (readOnly) return;
      const v = getBodyEditorView();
      if (!v) return;
      setWatermark(watermark)(v.state, v.dispatch);
    },
    [readOnly, getBodyEditorView]
  );

  return {
    showWatermark,
    setShowWatermark,
    handleOpenWatermark,
    currentWatermark,
    handleWatermarkApply,
  };
}
