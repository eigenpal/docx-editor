// Go To for bookmarks, with no UI attached: the Vue twin of the React hook. The Go to tab of
// `DocxEditor.Navigation` is built on it; call it to drive a Go To UI of your own.
//
// The list is the `bookmarks` query, so it follows every change to the document, a
// collaborator's included. The jump is the `goToBookmark` command: it selects the bookmark's
// text in whichever story holds it and scrolls it into view, in a read-only document too.

import { computed, shallowRef, type ComputedRef, type ShallowRef } from 'vue';
import type { BookmarkSummary, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import {
  goToBookmarkRows,
  goToBookmarkTarget,
  type BookmarkSortOrder,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useBookmarks } from '../useBookmarks';

/** Why a Go To jump did not happen. @public */
export type GoToBookmarkProblem = 'empty' | 'notFound';

/** What `useGoToBookmark` returns. @public */
export interface UseGoToBookmarkReturn {
  /** The text in the name box. Writing it puts the highlight back on the first row. */
  readonly query: Readonly<ShallowRef<string>>;
  readonly setQuery: (query: string) => void;
  readonly sortBy: ShallowRef<BookmarkSortOrder>;
  /** Whether hidden bookmarks (names starting with an underscore) are offered. */
  readonly showHidden: ShallowRef<boolean>;
  /** The bookmarks offered for the query: names that start with it first. */
  readonly rows: ComputedRef<readonly BookmarkSummary[]>;
  /** Every bookmark the document declares, hidden ones included. */
  readonly bookmarks: Readonly<ShallowRef<readonly BookmarkSummary[]>>;
  /** Index into `rows` of the highlighted row, or -1 when none is. */
  readonly activeIndex: ComputedRef<number>;
  /** Move the highlight by `delta` rows, wrapping at either end. */
  readonly move: (delta: number) => void;
  readonly setActiveIndex: (index: number) => void;
  /**
   * Jump to `name`, or else to what the name box means: the highlighted row, the bookmark
   * named exactly as typed, or the first row offered. Answers the `goToBookmark` result; a
   * name no bookmark has refuses with `notFound` and sets `problem`.
   */
  readonly go: (name?: string) => ExecResult;
  /** Why the last jump did not happen, or null. Cleared when the query changes. */
  readonly problem: Readonly<ShallowRef<GoToBookmarkProblem | null>>;
}

const NOT_READY: ExecResult = { ok: false, code: 'unsupported', reason: 'editor is not ready' };

/**
 * Go To for bookmarks: filter by name, move through the offered rows, and jump.
 *
 * @public
 */
export function useGoToBookmark(): UseGoToBookmarkReturn {
  const editorRef = useDocxEditor();
  const { bookmarks } = useBookmarks();
  const query = shallowRef('');
  const sortBy = shallowRef<BookmarkSortOrder>('name');
  const showHidden = shallowRef(false);
  const highlight = shallowRef(-1);
  const problem = shallowRef<GoToBookmarkProblem | null>(null);

  const rows = computed(() =>
    goToBookmarkRows(bookmarks.value, {
      query: query.value,
      sortBy: sortBy.value,
      showHidden: showHidden.value,
    })
  );
  // A highlight past the end (a bookmark went away) falls back to none.
  const activeIndex = computed(() => (highlight.value < rows.value.length ? highlight.value : -1));

  const setQuery = (next: string) => {
    query.value = next;
    highlight.value = -1;
    problem.value = null;
  };

  const move = (delta: number) => {
    const count = rows.value.length;
    if (count === 0) return;
    const current = highlight.value;
    const from = current < 0 || current >= count ? (delta > 0 ? -1 : 0) : current;
    highlight.value = (from + delta + count) % count;
  };

  const go = (name?: string): ExecResult => {
    const editor = editorRef.value;
    if (!editor) return NOT_READY;
    const target =
      name ??
      rows.value[activeIndex.value]?.name ??
      goToBookmarkTarget(bookmarks.value, query.value, rows.value)?.name;
    if (target === undefined || target.trim().length === 0) {
      problem.value = query.value.trim().length === 0 ? 'empty' : 'notFound';
      return { ok: false, code: 'notFound', reason: 'no bookmark is named that' };
    }
    const result = editor.exec({ type: 'goToBookmark', name: target });
    problem.value = result.ok ? null : 'notFound';
    return result;
  };

  return {
    query,
    setQuery,
    sortBy,
    showHidden,
    rows,
    bookmarks,
    activeIndex,
    move,
    setActiveIndex: (index: number) => {
      highlight.value = index;
    },
    go,
    problem,
  };
}
