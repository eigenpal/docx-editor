import { computed, type ComputedRef } from 'vue';
import {
  IMAGE_WRAP_TARGETS,
  runToolbarCommand,
  toolbarCommandState,
  type ImageWrapTarget,
  type ObjectSlotValueMap,
  type ToolbarValueMap,
} from '@docx-editor.dev/core/editor';
import type { EditorExecOptions, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** @public */
export interface EditorValueCommandState<T extends string | number> {
  readonly execute: (value: T, options?: EditorExecOptions) => ExecResult;
  readonly value: ComputedRef<T | null>;
  readonly options: ComputedRef<readonly T[]>;
  readonly isEnabled: ComputedRef<boolean>;
  readonly disabledReason: ComputedRef<string | null>;
}
/**
 * Bind a value slot. Font size values use half-points; colors use six digits without `#`. The
 * `shape.*` and `chart.*` slots bind through `useObjectControl`. @public
 */
export function useEditorValueCommand<
  K extends Exclude<keyof ToolbarValueMap, keyof ObjectSlotValueMap>,
>(slotId: K): EditorValueCommandState<ToolbarValueMap[K]> {
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const state = useEditorState(
    () => toolbarCommandState(editor.value, slotId),
    (a, b) =>
      a.value === b.value && a.enabled === b.enabled && a.disabledReason === b.disabledReason
  );
  return {
    execute: (value, options) => runToolbarCommand(editor.value, slotId, value, options),
    value: computed(
      () =>
        (state.value.value === undefined
          ? null
          : slotId === 'font.size' || slotId === 'list.lineSpacing'
            ? Number(state.value.value)
            : state.value.value) as ToolbarValueMap[K] | null
    ),
    options: computed(
      () => (slotId === 'image.wrap' ? IMAGE_WRAP_TARGETS : []) as readonly ToolbarValueMap[K][]
    ),
    isEnabled: computed(() => state.value.enabled),
    // Translated, as `useEditorCommand` gives it.
    disabledReason: computed(() => localizeDisabledReason(state.value.disabledReason, t)),
  };
}
/** @public */
export type { ImageWrapTarget };
