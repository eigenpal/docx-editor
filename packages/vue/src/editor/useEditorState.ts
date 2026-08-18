import { getCurrentScope, shallowRef, toValue, watch, type ShallowRef } from 'vue';
import { scopeDispose } from './scope-dispose';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { LOADING_SNAPSHOT } from '@docx-editor.dev/core/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';
import { useDocxEditor, useEditorStateTick } from './context';

let activeEditorStateSubscriptions = 0;

/** @internal */
export function editorStateActiveSubscriptionCount(): number {
  return activeEditorStateSubscriptions;
}

/** @internal */
export interface UseEditorStateOptions {
  readonly onSubscribe?: () => void;
  readonly onUnsubscribe?: () => void;
  readonly extraDeps?: MaybeRefOrGetter<unknown>;
}

/** @public */
export function useEditorState<T>(
  selector: (snapshot: EditorSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
  options?: UseEditorStateOptions
): Readonly<ShallowRef<T>> {
  const editorRef = useDocxEditor();
  const tick = useEditorStateTick();

  let hasMemo = false;
  let memoSnapshot: EditorSnapshot;
  let memoSlice: T;

  const derive = (snapshot: EditorSnapshot): T => {
    if (hasMemo && snapshot === memoSnapshot) return memoSlice;
    const next = selector(snapshot);
    if (hasMemo && isEqual(memoSlice, next)) {
      memoSnapshot = snapshot;
      return memoSlice;
    }
    hasMemo = true;
    memoSnapshot = snapshot;
    memoSlice = next;
    return next;
  };

  const read = (): T => {
    const editor = editorRef.value;
    return derive(editor ? editor.snapshot() : LOADING_SNAPSHOT);
  };

  const out = shallowRef(read()) as ShallowRef<T>;

  if (getCurrentScope()) {
    activeEditorStateSubscriptions++;
    options?.onSubscribe?.();
    watch(
      [
        editorRef,
        tick,
        () => (options?.extraDeps !== undefined ? toValue(options.extraDeps) : null),
      ],
      () => {
        hasMemo = false;
        const next = read();
        if (!isEqual(out.value, next)) out.value = next;
      },
      { flush: 'post' }
    );
    scopeDispose(() => {
      activeEditorStateSubscriptions--;
      options?.onUnsubscribe?.();
    });
  }

  return out;
}
