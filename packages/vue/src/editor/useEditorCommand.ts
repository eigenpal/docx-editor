import { computed, shallowRef, type ComputedRef } from 'vue';
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
  const editorRef = useDocxEditor();
  const latest = shallowRef(target);
  latest.value = target;
  const key = computed(() => (isSlot(target) ? target : stableKey(target)));

  const selectSlice = (_snapshot: unknown): CommandSlice => {
    const editor = editorRef.value;
    const current = latest.value;
    if (isSlot(current)) {
      const state = toolbarCommandState(editor, current);
      return {
        active: state.active,
        enabled: state.enabled,
        disabledReason: state.disabledReason,
      };
    }
    if (!editor) return { active: false, enabled: false, disabledReason: null };
    const allowed = editor.can(current);
    return {
      active: editor.isActive(current),
      enabled: allowed.ok,
      disabledReason: allowed.ok ? null : (allowed.reason ?? null),
    };
  };

  const slice = useEditorState(selectSlice, commandSliceEqual);

  const execute = (): boolean => {
    const current = latest.value;
    const editor = editorRef.value;
    if (isSlot(current)) return runToolbarCommand(editor, current).ok;
    if (!editor) return false;
    return editor.exec(current).ok;
  };

  void key.value;

  return {
    execute,
    isActive: computed(() => slice.value.active),
    isEnabled: computed(() => slice.value.enabled),
    disabledReason: computed(() => slice.value.disabledReason),
  };
}
