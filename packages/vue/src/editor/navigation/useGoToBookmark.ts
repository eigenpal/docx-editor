// Go To for bookmarks, with no UI attached: the Vue twin of the React hook. The Go to tab of
// `DocxEditor.Navigation` is built on it; call it to drive a Go To UI of your own.
//
// The list is the `bookmarks` query, so it follows every change to the document, a
// collaborator's included. It is read only while `enabled`: a closed pane does not walk the
// document on every keystroke. The jump is the `goToBookmark` command: it selects the
// bookmark's text in whichever story holds it and scrolls it into view, in a read-only
// document too.

import {
  computed,
  shallowRef,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue';
import type {
  BookmarkSummary,
  EditorSnapshot,
  ExecResult,
} from '@docx-editor.dev/core/contracts/editor';
import {
  goToBookmarkRows,
  goToBookmarkTarget,
  type BookmarkSortOrder,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { sameBookmarks } from '../useBookmarks';

/**
 * Why a Go To jump did not happen: nothing was typed, no bookmark has the name, or the editor
 * refused the jump for another reason (it is not ready, or the story could not be shown).
 *
 * @public
 */
export type GoToBookmarkProblem = 'empty' | 'notFound' | 'failed';

/** How `useGoToBookmark` is configured. @public */
export interface UseGoToBookmarkOptions {
  /**
   * Whether to read the document's bookmarks. Defaults to `true`. Pass `false` while your UI
   * is hidden: the list is then empty and the document is not read on each change. Pass the
   * options as a getter or a ref to change it; the list is read again when it turns true.
   */
  readonly enabled?: boolean;
}

/** What `useGoToBookmark` returns. @public */
export interface UseGoToBookmarkReturn {
  /** The text in the name box. Use `setQuery` to change it. */
  readonly query: Readonly<ShallowRef<string>>;
  /** Change the text. The highlight goes back to none. */
  readonly setQuery: (query: string) => void;
  readonly sortBy: Readonly<ShallowRef<BookmarkSortOrder>>;
  readonly setSortBy: (sortBy: BookmarkSortOrder) => void;
  /** Whether hidden bookmarks (names starting with an underscore) are offered. */
  readonly showHidden: Readonly<ShallowRef<boolean>>;
  readonly setShowHidden: (showHidden: boolean) => void;
  /** The bookmarks offered for the query: names that start with it first. */
  readonly rows: ComputedRef<readonly BookmarkSummary[]>;
  /** Every bookmark the document declares, hidden ones included. Empty while disabled. */
  readonly bookmarks: Readonly<ShallowRef<readonly BookmarkSummary[]>>;
  /**
   * Index into `rows` of the highlighted row, or -1 when none is. The highlight follows its
   * bookmark when rows move, and clears when that bookmark goes away.
   */
  readonly activeIndex: ComputedRef<number>;
  /** Move the highlight by `delta` rows, wrapping at either end. */
  readonly move: (delta: number) => void;
  /** Highlight the row at `index` of `rows`, or none with -1. */
  readonly setActiveIndex: (index: number) => void;
  /**
   * Jump to `name`, or else to what the name box means: the highlighted row, the bookmark
   * named exactly as typed, or the first row offered. Answers the `goToBookmark` result and
   * sets `problem` when it is refused.
   */
  readonly go: (name?: string) => ExecResult;
  /** Why the last jump did not happen, or null. Cleared when the query changes. */
  readonly problem: Readonly<ShallowRef<GoToBookmarkProblem | null>>;
  /** The name the last refused jump asked for, for a message. Empty when nothing was typed. */
  readonly problemName: Readonly<ShallowRef<string>>;
}

const NOT_READY: ExecResult = { ok: false, code: 'unsupported', reason: 'editor is not ready' };
const NONE: readonly BookmarkSummary[] = Object.freeze([]);

/**
 * Go To for bookmarks: filter by name, move through the offered rows, and jump.
 *
 * @public
 */
export function useGoToBookmark(
  options: MaybeRefOrGetter<UseGoToBookmarkOptions> = {}
): UseGoToBookmarkReturn {
  const editorRef = useDocxEditor();
  const enabled = () => toValue(options).enabled ?? true;
  const bookmarks = useEditorState(
    (_snapshot: EditorSnapshot): readonly BookmarkSummary[] =>
      enabled() ? (editorRef.value?.query({ type: 'bookmarks' }) ?? NONE) : NONE,
    sameBookmarks,
    // Opening the UI is no editor change: read again when `enabled` flips.
    { extraDeps: enabled }
  );
  const query = shallowRef('');
  const sortBy = shallowRef<BookmarkSortOrder>('name');
  const showHidden = shallowRef(false);
  // The highlighted bookmark's name, not its index: rows move when a collaborator edits.
  const highlight = shallowRef<string | null>(null);
  const problem = shallowRef<GoToBookmarkProblem | null>(null);
  const problemName = shallowRef('');

  const rows = computed(() =>
    goToBookmarkRows(bookmarks.value, {
      query: query.value,
      sortBy: sortBy.value,
      showHidden: showHidden.value,
    })
  );
  const activeIndex = computed(() =>
    highlight.value === null ? -1 : rows.value.findIndex((row) => row.name === highlight.value)
  );

  const setQuery = (next: string) => {
    query.value = next;
    highlight.value = null;
    problem.value = null;
  };
  const setSortBy = (next: BookmarkSortOrder) => {
    sortBy.value = next;
    highlight.value = null;
    problem.value = null;
  };
  const setShowHidden = (next: boolean) => {
    showHidden.value = next;
    highlight.value = null;
    problem.value = null;
  };

  const move = (delta: number) => {
    const list = rows.value;
    if (list.length === 0) return;
    const current = activeIndex.value;
    const from = current < 0 ? (delta > 0 ? -1 : 0) : current;
    highlight.value = list[(from + delta + list.length) % list.length]!.name;
  };
  const setActiveIndex = (index: number) => {
    highlight.value = rows.value[index]?.name ?? null;
  };

  const go = (name?: string): ExecResult => {
    const editor = editorRef.value;
    if (!editor) return NOT_READY;
    const target =
      name ??
      rows.value[activeIndex.value]?.name ??
      goToBookmarkTarget(bookmarks.value, query.value, rows.value)?.name;
    if (target === undefined || target.trim().length === 0) {
      const typed = query.value.trim();
      problem.value = typed.length === 0 ? 'empty' : 'notFound';
      problemName.value = typed;
      return { ok: false, code: 'notFound', reason: 'no bookmark is named that' };
    }
    const result = editor.exec({ type: 'goToBookmark', name: target });
    problem.value = result.ok ? null : result.code === 'notFound' ? 'notFound' : 'failed';
    problemName.value = result.ok ? '' : target;
    return result;
  };

  return {
    query,
    setQuery,
    sortBy,
    setSortBy,
    showHidden,
    setShowHidden,
    rows,
    bookmarks,
    activeIndex,
    move,
    setActiveIndex,
    go,
    problem,
    problemName,
  };
}
