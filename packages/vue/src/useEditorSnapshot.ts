import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';

/** @public */
export function useEditorSnapshot(editor: MaybeRefOrGetter<Editor | null>): Ref<number> {
  const revision = ref(0);

  const stop = watch(
    () => toValue(editor),
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

  onScopeDispose(stop);
  return revision;
}
