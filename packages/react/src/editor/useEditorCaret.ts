// Where the caret is, as a paragraph and an offset.
//
// Anything a host inserts AT A PLACE needs this, and `snapshot.selection` cannot answer it:
// `DocRange` addresses paragraphs by id and carries no offsets, so a caret and a range inside
// one paragraph are the same value there. Without this hook, hosts reached for the
// instance-only `surface` escape hatch instead.
//
// Reference-stable, so it can be used as a dependency and captured in a handler.

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';

/**
 * A caret position: a paragraph and a UTF-16 offset inside it — the shape the write APIs take
 * as their `at`.
 *
 * @public
 */
export interface EditorCaret {
  readonly paragraphId: string;
  readonly offset: number;
}

/** The instance-only surface, read defensively — an `Editor` need not have mounted one. */
function caretOf(editor: Editor | null): EditorCaret | null {
  const surface = (editor as (Editor & { readonly surface?: unknown }) | null)?.surface as
    | { state(): { selection: { head?: EditorCaret } } }
    | null
    | undefined;
  const head = surface?.state?.().selection?.head;
  return head && typeof head.paragraphId === 'string' && Number.isFinite(head.offset) ? head : null;
}

/**
 * The caret's paragraph and offset, or null when nothing is placed.
 *
 * Compared by value, so a consumer re-renders only when the caret actually moves.
 *
 * ```tsx
 * const caret = useEditorCaret();
 * // …later, in a menu row that inserts at where the user was reading:
 * insertCustomNode(editor, citation, attrs, label, caret ? { at: caret } : {});
 * ```
 *
 * @public
 */
export function useEditorCaret(): EditorCaret | null {
  const editor = useDocxEditor();
  const cached = useRef<EditorCaret | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!editor) return () => undefined;
      // Both: a commit can move the caret without a selection event (typing, undo).
      const offSelection = editor.on('selectionChange', onChange);
      const offChange = editor.on('change', onChange);
      return () => {
        offSelection();
        offChange();
      };
    },
    [editor]
  );

  const read = useCallback((): EditorCaret | null => {
    const next = caretOf(editor);
    const previous = cached.current;
    if (next === null ? previous === null : previous !== null && sameCaret(previous, next)) {
      return previous;
    }
    cached.current = next;
    return next;
  }, [editor]);

  // Null on the server: there is no surface to measure there.
  return useSyncExternalStore(subscribe, read, () => null);
}

function sameCaret(a: EditorCaret, b: EditorCaret): boolean {
  return a.paragraphId === b.paragraphId && a.offset === b.offset;
}
