// Where the caret is, as a paragraph and an offset.
//
// This exists because hosts were reaching for `editor.surface` to get it. Anything a host
// inserts AT A PLACE needs this — a citation at the caret, a footnote, a content control —
// and `snapshot.selection` cannot answer: `DocRange` addresses paragraphs by id and carries
// no offsets, so a caret and a range inside one paragraph are the same value there. The
// surface is documented as an escape hatch for chrome, and reading a caret is not chrome.
//
// REFERENCE-STABLE, because the whole point is to use it as a dependency and as a captured
// value. A new object per selection tick would re-run every effect that watches it, and
// hosts that capture it in a menu handler would see a different identity than the one they
// rendered with.

import { useCallback, useRef, useSyncExternalStore } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import { useDocxEditor } from './context';

/**
 * A caret position: a paragraph and a UTF-16 offset inside it.
 *
 * The same shape the write APIs take as an `at`, so it can be handed straight to one.
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
 * Re-renders only when the caret actually MOVES: the position is compared by value and the
 * previous object is handed back when it has not changed, so a component reading this is not
 * woken by every unrelated selection event.
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
      // Both events: the caret moves on selection, and a commit can move it without one
      // (typing, an undo that restores an earlier position).
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

  // The server snapshot is `null` rather than `read`: there is no surface to measure while
  // rendering on a server, and calling through would be a different answer per pass.
  return useSyncExternalStore(subscribe, read, () => null);
}

function sameCaret(a: EditorCaret, b: EditorCaret): boolean {
  return a.paragraphId === b.paragraphId && a.offset === b.offset;
}
