import { ref, toValue, watch, type Ref } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { MaybeRefOrGetter } from './maybe-ref-or-getter';
import { scopeDispose } from './editor/scope-dispose';

/** @public */
export function useEditorSnapshot(editor: MaybeRefOrGetter<Editor | null>): Ref<number> {
  const reactiveEditor = editor;
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
