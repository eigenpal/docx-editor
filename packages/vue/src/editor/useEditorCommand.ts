import { computed, shallowRef, toValue, watch, type ComputedRef } from 'vue';
import {
  editorCommandKey,
  runToolbarCommand,
  toolbarCommandState,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** @public */
export interface EditorCommandState {
  readonly execute: () => boolean;
  readonly isActive: ComputedRef<boolean>;
  readonly isEnabled: ComputedRef<boolean>;
  readonly disabledReason: ComputedRef<string | null>;
  /**
   * What the control SHOWS, for the slots whose answer is a value rather than a pressed
   * state — the editing-mode pill, and the format painter's `off` / `once` / `locked`.
   *
   * `isActive` cannot express it: "armed for one paint" and "locked on until Escape" are
   * both pressed, and only one of them ends with a keystroke. Null for every slot whose
   * state really is just pressed-or-not, and for the raw-command form.
   */
  readonly value: ComputedRef<string | null>;
}

interface CommandSlice {
  readonly active: boolean;
  readonly enabled: boolean;
  readonly disabledReason: string | null;
  readonly value: string | null;
}

function commandSliceEqual(a: CommandSlice, b: CommandSlice): boolean {
  return (
    a.active === b.active &&
    a.enabled === b.enabled &&
    a.disabledReason === b.disabledReason &&
    a.value === b.value
  );
}

function isSlot(target: ChromeSlotId | EditorCommand): target is ChromeSlotId {
  return typeof target === 'string';
}

/** @public */
export function useEditorCommand(
  target: MaybeRefOrGetter<ChromeSlotId | EditorCommand>
): EditorCommandState {
  const reactiveTarget = target;
  const editorRef = useDocxEditor();
  const { t } = useTranslation();
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
    return isSlot(current) ? current : editorCommandKey(current);
  });

  const selectSlice = (_snapshot: unknown): CommandSlice => {
    const current = latest.value;
    if (isSlot(current)) {
      const state = toolbarCommandState(editorRef.value, current);
      return {
        active: state.active,
        enabled: state.enabled,
        disabledReason: localizeDisabledReason(state.disabledReason, t),
        value: state.value ?? null,
      };
    }
    if (!editorRef.value) {
      return { active: false, enabled: false, disabledReason: null, value: null };
    }
    const allowed = editorRef.value.can(current);
    return {
      active: editorRef.value.isActive(current),
      enabled: allowed.ok,
      disabledReason: allowed.ok ? null : localizeDisabledReason(allowed.reason ?? null, t),
      // A raw command has no registry slot to report a value FOR — `toolbarCommandState`
      // is the only thing that derives one.
      value: null,
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
    value: computed(() => slice.value.value),
  };
}
