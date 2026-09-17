import { shallowRef, watch } from 'vue';
import {
  bindHistoryGroup,
  type HistoryGroupBinding,
  type HistoryGroupBindingOptions,
} from '@docx-editor.dev/core/editor';
import type { EditorExecOptions } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';

/** @public */
export interface UseHistoryGroupReturn {
  readonly ref: (element: HTMLElement | null) => void;
  readonly options: () => EditorExecOptions;
}
/** Bind a control's native gesture lifecycle. Apply values through the existing command hooks. @public */
export function useHistoryGroup({ kind }: HistoryGroupBindingOptions): UseHistoryGroupReturn {
  const editor = useDocxEditor();
  const element = shallowRef<HTMLElement | null>(null);
  let binding: HistoryGroupBinding | null = null;
  watch(
    [editor, element],
    ([currentEditor, currentElement], _old, onCleanup) => {
      if (!currentEditor || !currentElement) return;
      const current = bindHistoryGroup(currentEditor, currentElement, { kind });
      binding = current;
      onCleanup(() => {
        current.dispose();
        binding = null;
      });
    },
    { immediate: true, flush: 'sync' }
  );
  return {
    ref: (node) => {
      element.value = node;
    },
    options() {
      if (!binding) throw new Error('history group control is not mounted');
      return binding.options();
    },
  };
}
