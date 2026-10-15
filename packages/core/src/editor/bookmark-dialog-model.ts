// The Bookmark dialog's logic, shared by the React and Vue dialogs so the two cannot drift:
// which bookmarks the list shows and in which order, and what the typed name allows.

import {
  bookmarkNameKey,
  bookmarkNameProblem,
  isHiddenBookmarkName,
  type BookmarkNameProblem,
} from '@docx-editor.dev/core/store';
import type { BookmarkSummary } from '../contracts/editor-bookmarks.ts';

/**
 * How the Bookmark dialog orders its list: by name, or by where each bookmark is.
 *
 * @public
 */
export type BookmarkSortOrder = 'name' | 'location';

/**
 * The bookmarks the dialog lists. Hidden bookmarks show only when asked for. Names sort
 * without case, and location sorts by document order.
 *
 * @public
 */
export function bookmarkDialogRows(
  bookmarks: readonly BookmarkSummary[],
  options: { readonly sortBy: BookmarkSortOrder; readonly showHidden: boolean }
): readonly BookmarkSummary[] {
  const rows = bookmarks.filter((bookmark) => options.showHidden || !bookmark.hidden);
  return options.sortBy === 'location'
    ? [...rows].sort((a, b) => a.order - b.order)
    : [...rows].sort(
        (a, b) =>
          bookmarkNameKey(a.name).localeCompare(bookmarkNameKey(b.name)) || a.order - b.order
      );
}

/**
 * The name the dialog starts with: the visible bookmark the selection is in, or an empty name.
 *
 * @public
 */
export function bookmarkDialogInitialName(bookmarks: readonly BookmarkSummary[]): string {
  return bookmarks.find((bookmark) => bookmark.atSelection && !bookmark.hidden)?.name ?? '';
}

/**
 * What the typed name allows in the Bookmark dialog.
 *
 * @public
 */
export interface BookmarkDialogNameState {
  /** Why Add cannot use the name, or null when it can. Hidden names cannot be added. */
  readonly problem: BookmarkNameProblem | null;
  /** The bookmark the name already belongs to, compared without case, or null. */
  readonly existing: BookmarkSummary | null;
  /** Add bookmarks the selection under the name; an existing bookmark moves. */
  readonly canAdd: boolean;
  /** Delete and Go To act on an existing bookmark. */
  readonly canDelete: boolean;
  readonly canGoTo: boolean;
}

/**
 * Evaluate the name typed in the Bookmark dialog against the document's bookmarks.
 * `writable` is whether the document accepts edits; Go To works either way.
 *
 * @public
 */
export function bookmarkDialogNameState(
  bookmarks: readonly BookmarkSummary[],
  name: string,
  writable: boolean
): BookmarkDialogNameState {
  const problem = bookmarkNameProblem(name) ?? (isHiddenBookmarkName(name) ? 'invalidStart' : null);
  const key = bookmarkNameKey(name);
  const existing =
    name.length === 0
      ? null
      : (bookmarks.find((bookmark) => bookmarkNameKey(bookmark.name) === key) ?? null);
  return {
    problem,
    existing,
    canAdd: writable && problem === null,
    canDelete: writable && existing !== null,
    canGoTo: existing !== null,
  };
}
