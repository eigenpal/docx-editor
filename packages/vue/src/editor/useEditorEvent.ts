import { watch } from 'vue';
import type { EditorEvents } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';

/** @public */
export function useEditorEvent<E extends keyof EditorEvents>(
  event: E,
  handler: EditorEvents[E]
): void {
  const editorRef = useDocxEditor();
  const handlerRef = { current: handler };
  handlerRef.current = handler;

  watch(
    () => editorRef.value,
    (_editor, _prev, onCleanup) => {
      if (!editorRef.value) return;
      const forward = ((...args: unknown[]) => {
        (handlerRef.current as (...forwarded: unknown[]) => void)(...args);
      }) as unknown as EditorEvents[E];
      const off = editorRef.value.on(event, forward);
      onCleanup(off);
    },
    { immediate: true, flush: 'post' }
  );
}
