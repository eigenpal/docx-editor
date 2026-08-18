import { computed, shallowRef, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import {
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** @public */
export interface EditorCommandState {
  readonly execute: () => boolean;
  readonly isActive: ComputedRef<boolean>;
  readonly isEnabled: ComputedRef<boolean>;
  readonly disabledReason: ComputedRef<string | null>;
}

interface CommandSlice {
  readonly active: boolean;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
}

function commandSliceEqual(a: CommandSlice, b: CommandSlice): boolean {
  return a.active === b.active && a.enabled === b.enabled && a.disabledReason === b.disabledReason;
}

function isSlot(target: ChromeSlotId | EditorCommand): target is ChromeSlotId {
  return typeof target === 'string';
}

function stableKey(command: EditorCommand): string {
  return JSON.stringify(command, Object.keys(command).sort());
}

/** @public */
export function useEditorCommand(target: ChromeSlotId | EditorCommand): EditorCommandState {
  const reactiveTarget = target as MaybeRefOrGetter<ChromeSlotId | EditorCommand>;
  const editorRef = useDocxEditor();
  const latest = shallowRef(toValue(reactiveTarget));

  watch(
    () => toValue(reactiveTarget),
    (next) => {
      latest.value = next;
    },
    { flush: 'sync' }
  );

  const key = computed(() => {
    const current = latest.value;
    return isSlot(current) ? current : stableKey(current);
  });

  const selectSlice = (_snapshot: unknown): CommandSlice => {
    const current = latest.value;
    if (isSlot(current)) {
      const state = toolbarCommandState(editorRef.value, current);
      return {
        active: state.active,
        enabled: state.enabled,
        disabledReason: state.disabledReason,
      };
    }
    if (!editorRef.value) return { active: false, enabled: false, disabledReason: null };
    const allowed = editorRef.value.can(current);
    return {
      active: editorRef.value.isActive(current),
      enabled: allowed.ok,
      disabledReason: allowed.ok ? null : (allowed.reason ?? null),
    };
  };

  const slice = useEditorState(selectSlice, commandSliceEqual, { extraDeps: key });

  void key.value;

  const execute = (): boolean => {
    const current = latest.value;
    if (isSlot(current)) return runToolbarCommand(editorRef.value, current).ok;
    if (!editorRef.value) return false;
    return editorRef.value!.exec(current).ok;
  };

  return {
    execute,
    isActive: computed(() => slice.value.active),
    isEnabled: computed(() => slice.value.enabled),
    disabledReason: computed(() => slice.value.disabledReason),
  };
}
