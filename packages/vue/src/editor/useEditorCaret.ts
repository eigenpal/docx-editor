import { shallowRef, watch, type ShallowRef } from 'vue';
import { scopeDispose } from './scope-dispose';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';

/** @public */
export interface EditorCaret {
  /** The paragraph, as `TextPosition.blockId` and `TextMatch.blockId` name it. */
  readonly blockId: string;
  /**
   * The same paragraph id as `blockId`, for `at` parameters that take `paragraphId`.
   *
   * @deprecated Use `blockId`.
   */
  readonly paragraphId: string;
  /** UTF-16 offset in the paragraph's model text. */
  readonly offset: number;
}

function caretOf(editor: Editor | null): EditorCaret | null {
  const surface = (editor as (Editor & { readonly surface?: unknown }) | null)?.surface as
    | { state(): { selection: { head?: { paragraphId?: unknown; offset?: unknown } } } }
    | null
    | undefined;
  const head = surface?.state?.().selection?.head;
  if (!head || typeof head.paragraphId !== 'string') return null;
  const offset = head.offset;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) return null;
  return { blockId: head.paragraphId, paragraphId: head.paragraphId, offset };
}

function sameCaret(a: EditorCaret, b: EditorCaret): boolean {
  return a.blockId === b.blockId && a.offset === b.offset;
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

  scopeDispose(stop);
  return out;
}
