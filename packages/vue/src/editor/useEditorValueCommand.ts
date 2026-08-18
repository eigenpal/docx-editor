import { computed, shallowRef, type ComputedRef } from 'vue';
import {
  IMAGE_WRAP_TARGETS,
  runToolbarCommand,
  toolbarCommandState,
  type ImageWrapTarget,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** @public */
export interface EditorValueCommandState<T extends string | number> {
  readonly execute: (value: T) => void;
  readonly value: ComputedRef<T | null>;
  readonly options: ComputedRef<readonly T[]>;
  readonly isEnabled: ComputedRef<boolean>;
  readonly disabledReason: ComputedRef<string | null>;
}

interface ValueSlice {
  readonly value: string | null;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

function valueSliceEqual(a: ValueSlice, b: ValueSlice): boolean {
  return a.value === b.value && a.enabled === b.enabled && a.disabledReason === b.disabledReason;
}

/** @public */
export function useEditorValueCommand(
  slotId: 'image.wrap'
): EditorValueCommandState<ImageWrapTarget>;
/** @public */
export function useEditorValueCommand(slotId: 'image.altText'): EditorValueCommandState<string>;
/** @public */
export function useEditorValueCommand(
  slotId: 'image.wrap' | 'image.altText'
): EditorValueCommandState<ImageWrapTarget> | EditorValueCommandState<string> {
  const editorRef = useDocxEditor();
  const latest = shallowRef(slotId);
  latest.value = slotId;

  const selectSlice = (_snapshot: unknown): ValueSlice => {
    const state = toolbarCommandState(editorRef.value, latest.value);
    return {
      value: state.value ?? null,
      enabled: state.enabled,
      disabledReason: state.disabledReason,
    };
  };

  const slice = useEditorState(selectSlice, valueSliceEqual);

  if (slotId === 'image.wrap') {
    return {
      execute: (value: ImageWrapTarget) => runToolbarCommand(editorRef.value, 'image.wrap', value),
      value: computed(() => (slice.value.value as ImageWrapTarget | null) ?? null),
      options: computed(() => IMAGE_WRAP_TARGETS),
      isEnabled: computed(() => slice.value.enabled),
      disabledReason: computed(() => slice.value.disabledReason),
    };
  }

  return {
    execute: (value: string) => runToolbarCommand(editorRef.value, 'image.altText', value),
    value: computed(() => slice.value.value),
    options: computed(() => [] as readonly string[]),
    isEnabled: computed(() => slice.value.enabled),
    disabledReason: computed(() => slice.value.disabledReason),
  };
}

/** @public */
export type { ImageWrapTarget };
