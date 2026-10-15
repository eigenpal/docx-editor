// Go To for bookmarks, with no UI attached: what was typed, the bookmarks it offers, the
// highlighted row, and the jump. The Go to tab of `DocxEditor.Navigation` is built on it; call
// it directly to drive a Go To UI of your own.
//
// The list is the `bookmarks` query, so it follows every change to the document, a
// collaborator's included. The jump is the `goToBookmark` command: it selects the bookmark's
// text in whichever story holds it and scrolls it into view, in a read-only document too.

import { useCallback, useMemo, useState } from 'react';
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

/** What `useGoToBookmark` answers. @public */
export interface UseGoToBookmarkReturn {
  /** The text in the name box. */
  readonly query: string;
  /** Change the text. The highlighted row goes back to the first one offered. */
  readonly setQuery: (query: string) => void;
  readonly sortBy: BookmarkSortOrder;
  readonly setSortBy: (sortBy: BookmarkSortOrder) => void;
  /** Whether hidden bookmarks (names starting with an underscore) are offered. */
  readonly showHidden: boolean;
  readonly setShowHidden: (showHidden: boolean) => void;
  /** The bookmarks offered for the query: names that start with it first. */
  readonly rows: readonly BookmarkSummary[];
  /** Every bookmark the document declares, hidden ones included. */
  readonly bookmarks: readonly BookmarkSummary[];
  /** Index into `rows` of the highlighted row, or -1 when none is. */
  readonly activeIndex: number;
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
  readonly problem: GoToBookmarkProblem | null;
}

const NOT_READY: ExecResult = { ok: false, code: 'unsupported', reason: 'editor is not ready' };

/**
 * Go To for bookmarks: filter by name, move through the offered rows, and jump.
 *
 * @public
 */
export function useGoToBookmark(): UseGoToBookmarkReturn {
  const editor = useDocxEditor();
  const { bookmarks } = useBookmarks();
  const [query, setQueryState] = useState('');
  const [sortBy, setSortBy] = useState<BookmarkSortOrder>('name');
  const [showHidden, setShowHidden] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [problem, setProblem] = useState<GoToBookmarkProblem | null>(null);

  const rows = useMemo(
    () => goToBookmarkRows(bookmarks, { query, sortBy, showHidden }),
    [bookmarks, query, sortBy, showHidden]
  );
  // A highlight past the end (a bookmark went away) falls back to none.
  const activeIndex = highlight < rows.length ? highlight : -1;

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setHighlight(-1);
    setProblem(null);
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      setHighlight((current) => {
        const from = current < 0 || current >= rows.length ? (delta > 0 ? -1 : 0) : current;
        return (from + delta + rows.length) % rows.length;
      });
    },
    [rows.length]
  );

  const go = useCallback(
    (name?: string): ExecResult => {
      if (!editor) return NOT_READY;
      const target =
        name ?? rows[activeIndex]?.name ?? goToBookmarkTarget(bookmarks, query, rows)?.name;
      if (target === undefined || target.trim().length === 0) {
        setProblem(query.trim().length === 0 ? 'empty' : 'notFound');
        return { ok: false, code: 'notFound', reason: 'no bookmark is named that' };
      }
      const result = editor.exec({ type: 'goToBookmark', name: target });
      setProblem(result.ok ? null : 'notFound');
      return result;
    },
    [editor, rows, activeIndex, bookmarks, query]
  );

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
    setActiveIndex: setHighlight,
    go,
    problem,
  };
}
