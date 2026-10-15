// The document's bookmarks as a composable: the list through the `bookmarks` query, and the
// insert, delete and go-to commands. The Vue twin of the React hook.

import type { ShallowRef } from 'vue';
import type {
  BookmarkSummary,
  EditorSnapshot,
  ExecResult,
} from '@docx-editor.dev/core/contracts/editor';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

/** What `useBookmarks` returns. @public */
export interface UseBookmarksReturn {
  /** Every bookmark, hidden ones included, in document order. Reference-stable while unchanged. */
  readonly bookmarks: Readonly<ShallowRef<readonly BookmarkSummary[]>>;
  /** Whether the document accepts bookmark edits now. Go To works either way. */
  readonly isWritable: Readonly<ShallowRef<boolean>>;
  /** Bookmark the selection under `name`. A bookmark with the name moves. */
  readonly insert: (name: string) => ExecResult;
  /** Delete the bookmark with this name. The text stays. */
  readonly remove: (name: string) => ExecResult;
  /** Select the bookmark and scroll to it. */
  readonly goTo: (name: string) => ExecResult;
}

const NOT_READY: ExecResult = { ok: false, code: 'unsupported', reason: 'editor is not ready' };
const NONE: readonly BookmarkSummary[] = Object.freeze([]);

function sameBookmarks(a: readonly BookmarkSummary[], b: readonly BookmarkSummary[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (bookmark, index) =>
        bookmark.name === b[index]!.name &&
        bookmark.order === b[index]!.order &&
        bookmark.story === b[index]!.story &&
        bookmark.empty === b[index]!.empty
    )
  );
}

/**
 * The document's bookmarks plus the commands that change them.
 *
 * @public
 */
export function useBookmarks(): UseBookmarksReturn {
  const editorRef = useDocxEditor();
  const bookmarks = useEditorState(
    (_snapshot: EditorSnapshot): readonly BookmarkSummary[] =>
      editorRef.value?.query({ type: 'bookmarks' }) ?? NONE,
    sameBookmarks
  );
  // Asked on every tick: the answer moves with the selection (a table of contents is
  // read-only) and with the editing mode.
  const isWritable = useEditorState(
    (snapshot: EditorSnapshot): boolean =>
      snapshot.editable &&
      editorRef.value !== null &&
      editorRef.value.can({ type: 'insertBookmark', name: 'Bookmark' }).ok
  );
  const insert = (name: string): ExecResult =>
    editorRef.value ? editorRef.value.exec({ type: 'insertBookmark', name }) : NOT_READY;
  const remove = (name: string): ExecResult =>
    editorRef.value ? editorRef.value.exec({ type: 'deleteBookmark', name }) : NOT_READY;
  const goTo = (name: string): ExecResult =>
    editorRef.value ? editorRef.value.exec({ type: 'goToBookmark', name }) : NOT_READY;
  return { bookmarks, isWritable, insert, remove, goTo };
}
