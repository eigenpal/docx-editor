// The document watermark as a composable: the read side through `getWatermark()`, the write
// side through the engine's `setWatermark` command. The Vue twin of the React hook.

import { computed, type ComputedRef, type ShallowRef } from 'vue';
import type {
  EditorSnapshot,
  ExecResult,
  Watermark,
  WatermarkState,
} from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';
import { watermarkStateEqual } from './watermark-dialog-model';

/** What `useWatermark` returns. @public */
export interface UseWatermarkReturn {
  /** The document's watermark, or null when it has none. Reference-stable while unchanged. */
  readonly watermark: Readonly<ShallowRef<WatermarkState | null>>;
  /** Whether the engine can write a watermark right now (mounted, editable). */
  readonly isEnabled: ComputedRef<boolean>;
  /** The full current watermark, with picture bytes, through `query({ type: 'watermark' })`. */
  readonly read: () => Watermark | null;
  /** Set the watermark as one undo step. Null removes it. */
  readonly apply: (watermark: Watermark | null) => ExecResult;
}

const selectEditable = (snapshot: EditorSnapshot): boolean => snapshot.editable;
const NOT_READY: ExecResult = { ok: false, code: 'unsupported', reason: 'editor is not ready' };

/**
 * The document watermark plus the command to change it.
 *
 * @public
 */
export function useWatermark(): UseWatermarkReturn {
  const editorRef = useDocxEditor();
  const watermark = useEditorState(
    (_snapshot: EditorSnapshot): WatermarkState | null => editorRef.value?.getWatermark() ?? null,
    watermarkStateEqual
  );
  const editable = useEditorState(selectEditable);
  // `can` needs a well-formed payload; a short text is always classifiable, so the answer
  // reflects only the mount and mode gates.
  const isEnabled = computed(
    () =>
      editable.value &&
      editorRef.value !== null &&
      editorRef.value.can({ type: 'setWatermark', watermark: { text: 'DRAFT' } }).ok
  );
  const read = (): Watermark | null => editorRef.value?.query({ type: 'watermark' }) ?? null;
  const apply = (next: Watermark | null): ExecResult =>
    editorRef.value ? editorRef.value.exec({ type: 'setWatermark', watermark: next }) : NOT_READY;
  return { watermark, isEnabled, read, apply };
}
