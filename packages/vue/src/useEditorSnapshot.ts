import { ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { scopeDispose } from './editor/scope-dispose';

/** @public */
export function useEditorSnapshot(editor: Editor | null): Ref<number> {
  const reactiveEditor = editor as MaybeRefOrGetter<Editor | null>;
  const revision = ref(0);

  const stop = watch(
    () => toValue(reactiveEditor),
    (instance, _prev, onCleanup) => {
      if (!instance) return;
      const bump = (): void => {
        revision.value++;
      };
      const offChange = instance.on('change', bump);
      const offSelection = instance.on('selectionChange', bump);
      bump();
      onCleanup(() => {
        offChange();
        offSelection();
      });
    },
    { immediate: true, flush: 'post' }
  );

  scopeDispose(stop);
  return revision;
}
