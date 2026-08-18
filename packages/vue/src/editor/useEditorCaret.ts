import { onScopeDispose, shallowRef, watch, type ShallowRef } from 'vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';

/** @public */
export interface EditorCaret {
  readonly paragraphId: string;
  readonly offset: number;
}

function caretOf(editor: Editor | null): EditorCaret | null {
  const surface = (editor as (Editor & { readonly surface?: unknown }) | null)?.surface as
    | { state(): { selection: { head?: EditorCaret } } }
    | null
    | undefined;
  const head = surface?.state?.().selection?.head;
  return head && typeof head.paragraphId === 'string' && Number.isFinite(head.offset) ? head : null;
}

function sameCaret(a: EditorCaret, b: EditorCaret): boolean {
  return a.paragraphId === b.paragraphId && a.offset === b.offset;
}

/** @public */
export function useEditorCaret(): ShallowRef<EditorCaret | null> {
  const editorRef = useDocxEditor();
  const out = shallowRef<EditorCaret | null>(null);
  let cached: EditorCaret | null = null;

  const read = (): EditorCaret | null => {
    const next = caretOf(editorRef.value);
    const previous = cached;
    if (next === null ? previous === null : previous !== null && sameCaret(previous, next)) {
      return previous;
    }
    cached = next;
    return next;
  };

  out.value = read();

  const stop = watch(
    () => editorRef.value,
    (editor, _prev, onCleanup) => {
      out.value = read();
      if (!editor) return;
      const bump = () => {
        const next = read();
        if (out.value !== next) out.value = next;
      };
      const offSelection = editor.on('selectionChange', bump);
      const offChange = editor.on('change', bump);
      onCleanup(() => {
        offSelection();
        offChange();
      });
    },
    { immediate: true, flush: 'post' }
  );

  onScopeDispose(stop);
  return out;
}
