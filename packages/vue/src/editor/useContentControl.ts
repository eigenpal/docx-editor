import { computed, inject, ref, watch, type ComputedRef, type InjectionKey } from 'vue';
import type { ContentControlSummary, ContentControlType } from '@docx-editor.dev/core';
import type { CanResult, EditorSnapshot, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** @public */
export type ContentControlLock = 'unlocked' | 'sdtLocked' | 'contentLocked' | 'sdtContentLocked';

/** @public */
export const CONTENT_CONTROL_SLOTS = {
  showAll: 'contentControl.showAll',
  formFill: 'contentControl.formFill',
  inspector: 'contentControl.inspector',
  remove: 'contentControl.remove',
} as const;

/** @public */
export type ContentControlSlotId =
  (typeof CONTENT_CONTROL_SLOTS)[keyof typeof CONTENT_CONTROL_SLOTS];

/** @public */
export interface ContentControlInspectorState {
  readonly id: string;
  readonly tag: string | null;
  readonly alias: string | null;
  readonly controlType: ContentControlType;
  readonly locked: boolean;
  readonly removalLocked: boolean;
  readonly placeholder: boolean;
  readonly bound: boolean;
  readonly effectiveLock: ContentControlLock | null;
}

/** @public */
export interface UseContentControlResult {
  readonly control: ComputedRef<ContentControlInspectorState | null>;
  readonly controls: ComputedRef<readonly ContentControlSummary[]>;
  readonly showAll: ComputedRef<boolean>;
  readonly formFill: ComputedRef<boolean>;
  readonly inspectorOpen: ComputedRef<boolean>;
  readonly canSetValue: ComputedRef<boolean>;
  readonly canRemove: ComputedRef<boolean>;
  readonly setValueDisabledReason: ComputedRef<string | null>;
  readonly removeDisabledReason: ComputedRef<string | null>;
  readonly setShowAll: (show: boolean) => void;
  readonly toggleShowAll: () => void;
  readonly setFormFill: (on: boolean) => void;
  readonly toggleFormFill: () => void;
  readonly openInspector: () => void;
  readonly closeInspector: () => void;
  readonly toggleInspector: () => void;
  readonly remove: () => ExecResult;
  readonly setValue: (value: string) => ExecResult;
}

function removalLockedFrom(lock: ContentControlLock | null | undefined): boolean {
  return lock === 'sdtLocked' || lock === 'sdtContentLocked';
}

function contentLockedFrom(lock: ContentControlLock | null | undefined): boolean {
  return lock === 'contentLocked' || lock === 'sdtContentLocked';
}

function reasonFromCan(result: CanResult, code: 'locked' | 'bound' | 'notFound'): boolean {
  return !result.ok && result.code === code;
}

/** @public */
export function useContentControl(): UseContentControlResult {
  const provided = inject(ContentControlContext, null);
  const own = useContentControlInstance();
  return provided ?? own;
}

/** @public */
export function useContentControlInstance(): UseContentControlResult {
  const editorRef = useDocxEditor();
  const inspectorOpen = ref(false);
  const showAll = ref(false);
  const formFill = ref(false);
  const tick = useEditorState((snapshot: EditorSnapshot) => snapshot);

  const surface = computed(() => editorRef.value?.surface ?? null);
  const cc = computed(() => surface.value?.contentControls ?? null);

  watch(
    [tick, cc, surface],
    () => {
      const controls = cc.value;
      const surf = surface.value;
      showAll.value = controls?.showAll() ?? surf?.state().contentControls.showAll ?? false;
      formFill.value = controls?.formFill() ?? surf?.state().contentControls.formFill ?? false;
    },
    { immediate: true, flush: 'post' }
  );

  const control = computed((): ContentControlInspectorState | null => {
    void tick.value;
    const contentControls = cc.value;
    if (!editorRef.value) return null;

    const boundary = contentControls?.atCaret() ?? null;
    if (boundary) {
      const editReason = contentControls?.disabledReason(boundary.id, 'edit') ?? null;
      const removeReason = contentControls?.disabledReason(boundary.id, 'remove') ?? null;
      return {
        id: boundary.id,
        tag: boundary.tag ?? null,
        alias: boundary.alias ?? null,
        controlType: boundary.controlType,
        locked: contentLockedFrom(boundary.effectiveLock) || editReason === 'locked',
        removalLocked: removalLockedFrom(boundary.effectiveLock) || removeReason === 'locked',
        placeholder: boundary.placeholder,
        bound: boundary.bound || editReason === 'bound',
        effectiveLock: boundary.effectiveLock,
      };
    }

    const summary = editorRef.value?.query({ type: 'contentControlAt' });
    if (!summary || !editorRef.value) return null;
    const editReason = contentControls?.disabledReason(summary.id, 'edit') ?? null;
    const removeReason = contentControls?.disabledReason(summary.id, 'remove') ?? null;
    const canEdit = editorRef.value!.can({ type: 'setContentControlValue', value: '' });
    const canRemove = editorRef.value!.can({ type: 'removeContentControl' });
    return {
      id: summary.id,
      tag: summary.tag ?? null,
      alias: summary.alias ?? null,
      controlType: summary.controlType,
      locked:
        summary.locked === true || editReason === 'locked' || reasonFromCan(canEdit, 'locked'),
      removalLocked: removeReason === 'locked' || reasonFromCan(canRemove, 'locked'),
      placeholder: false,
      bound: editReason === 'bound' || reasonFromCan(canEdit, 'bound'),
      effectiveLock: null,
    };
  });

  const controls = computed((): readonly ContentControlSummary[] => {
    void tick.value;
    return editorRef.value?.query({ type: 'contentControls' }) ?? [];
  });

  const setShowAll = (show: boolean) => {
    cc.value?.setShowAll(show);
    showAll.value = show;
  };
  const setFormFill = (on: boolean) => {
    cc.value?.setFormFill(on);
    formFill.value = on;
  };

  const setValueDisabledReason = computed(() => {
    const current = control.value;
    const contentControls = cc.value;
    if (!current) return 'no content control at the current selection';
    if (contentControls) {
      const reason = contentControls.disabledReason(current.id, 'edit');
      if (reason === 'locked') return 'the content control is locked';
      if (reason === 'bound') return 'the content control is bound to external data';
      if (reason === 'notFound') return 'the content control was not found';
      return reason;
    }
    if (current.locked) return 'the content control is locked';
    if (current.bound) return 'the content control is bound to external data';
    if (!editorRef.value) return 'no document is loaded';
    const canEdit = editorRef.value!.can({ type: 'setContentControlValue', value: '' });
    if (!canEdit.ok) return canEdit.reason;
    return null;
  });

  const removeDisabledReason = computed(() => {
    const current = control.value;
    const contentControls = cc.value;
    if (!current) return 'no content control at the current selection';
    if (contentControls) {
      const reason = contentControls.disabledReason(current.id, 'remove');
      if (reason === 'locked') return 'the content control is locked';
      if (reason === 'notFound') return 'the content control was not found';
      return reason;
    }
    if (current.removalLocked) return 'the content control is locked';
    if (!editorRef.value) return 'no document is loaded';
    const canRemove = editorRef.value!.can({ type: 'removeContentControl' });
    if (!canRemove.ok) return canRemove.reason;
    return null;
  });

  const setValue = (value: string): ExecResult => {
    const contentControls = cc.value;
    const current = control.value;
    if (!editorRef.value) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
    if (contentControls && current) {
      const reason = contentControls.disabledReason(current.id, 'edit');
      if (reason) {
        return {
          ok: false,
          code: reason === 'bound' ? 'bound' : reason === 'locked' ? 'locked' : 'notFound',
          reason:
            reason === 'bound'
              ? 'the content control is bound to external data'
              : reason === 'locked'
                ? 'the content control is locked'
                : 'the content control was not found',
        };
      }
    }
    return editorRef.value!.exec({ type: 'setContentControlValue', value });
  };

  const remove = (): ExecResult => {
    const contentControls = cc.value;
    const current = control.value;
    if (!editorRef.value) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
    if (contentControls) {
      const id = current?.id;
      if (!id) {
        return {
          ok: false,
          code: 'notFound',
          reason: 'no content control at the current selection',
        };
      }
      const reason = contentControls.disabledReason(id, 'remove');
      if (reason) {
        return {
          ok: false,
          code: reason === 'locked' ? 'locked' : 'notFound',
          reason:
            reason === 'locked'
              ? 'the content control is locked'
              : 'the content control was not found',
        };
      }
      const ok = contentControls.remove(id);
      return ok
        ? { ok: true, changed: true }
        : { ok: false, code: 'unsupported', reason: 'the edit was refused' };
    }
    return editorRef.value!.exec({ type: 'removeContentControl' });
  };

  return {
    control,
    controls,
    showAll: computed(() => showAll.value),
    formFill: computed(() => formFill.value),
    inspectorOpen: computed(() => inspectorOpen.value),
    canSetValue: computed(() => setValueDisabledReason.value === null && control.value !== null),
    canRemove: computed(() => removeDisabledReason.value === null && control.value !== null),
    setValueDisabledReason,
    removeDisabledReason,
    setShowAll,
    toggleShowAll: () => setShowAll(!showAll.value),
    setFormFill,
    toggleFormFill: () => setFormFill(!formFill.value),
    openInspector: () => {
      inspectorOpen.value = true;
    },
    closeInspector: () => {
      inspectorOpen.value = false;
    },
    toggleInspector: () => {
      inspectorOpen.value = !inspectorOpen.value;
    },
    remove,
    setValue,
  };
}

/** @internal */
export const ContentControlContext: InjectionKey<UseContentControlResult> =
  Symbol('ContentControlContext');
