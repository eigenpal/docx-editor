/**
 * Watermark controls — Vue mirror of React's `useWatermarkControls`.
 *
 * The document watermark lives as a `doc` node attribute on the body
 * ProseMirror state, so applying or removing it is a normal undoable
 * transaction (Ctrl+Z and the toolbar undo work, the painter reads it from PM
 * state, and the conversion layer syncs it to `HeaderFooter.watermark` on save).
 * This composable owns the dialog show-flag, exposes the current watermark for
 * the dialog to seed from, and dispatches the apply/remove command.
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { EditorView } from 'prosemirror-view';
import type { Watermark } from '@eigenpal/docx-editor-core/types/document';
import {
  setWatermark,
  getWatermarkFromState,
} from '@eigenpal/docx-editor-core/prosemirror/commands';

export interface UseWatermarkControlsOptions {
  editorView: Ref<EditorView | null>;
  readOnly: Ref<boolean>;
  /** Bumped on every edit/selection change; drives `currentWatermark` reactivity. */
  stateTick: Ref<number>;
}

export interface UseWatermarkControlsReturn {
  showWatermark: Ref<boolean>;
  currentWatermark: ComputedRef<Watermark | undefined>;
  handleWatermarkApply: (watermark: Watermark | null) => void;
}

export function useWatermarkControls(
  opts: UseWatermarkControlsOptions
): UseWatermarkControlsReturn {
  const showWatermark = ref(false);

  // Read from the live body PM state so the dialog reflects the current value
  // (including after undo/redo). `stateTick` forces re-evaluation since the
  // EditorView ref identity doesn't change when its state is replaced.
  const currentWatermark = computed<Watermark | undefined>(() => {
    void opts.stateTick.value;
    const view = opts.editorView.value;
    return view ? (getWatermarkFromState(view.state) ?? undefined) : undefined;
  });

  function handleWatermarkApply(watermark: Watermark | null) {
    if (opts.readOnly.value) return;
    const view = opts.editorView.value;
    if (!view) return;
    setWatermark(watermark)(view.state, view.dispatch);
    // setDocAttribute doesn't move the selection, so onSelectionUpdate may not
    // fire — bump explicitly so `currentWatermark` re-reads on next open.
    opts.stateTick.value++;
    view.focus();
  }

  return {
    showWatermark,
    currentWatermark,
    handleWatermarkApply,
  };
}
