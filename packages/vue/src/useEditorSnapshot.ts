import { onScopeDispose, ref, watch, type Ref } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';

/** @public */
export function useEditorSnapshot(editor: Editor | null): Ref<number> {
  const revision = ref(0);

  const stop = watch(
    () => editor,
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
