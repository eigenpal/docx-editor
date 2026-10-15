// The bookmark commands of `createDocxEditor`: insert at the selection, delete, and go to.
//
// The work happens in the surface's bookmark lane (`surface-bookmarks.ts`). This module turns
// its answers into the facade's `can` refusals and `exec` results.

import { bookmarkNameKey } from '@docx-editor.dev/core/store';
import type { CanResult, EditorCommand, ExecResult } from '../contracts/editor.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { bookmarkNameRefusal } from './surface-bookmarks.ts';

type BookmarkCommand = Extract<
  EditorCommand,
  { type: 'insertBookmark' | 'deleteBookmark' | 'goToBookmark' }
>;

function isBookmarkCommand(command: EditorCommand): command is BookmarkCommand {
  return (
    command.type === 'insertBookmark' ||
    command.type === 'deleteBookmark' ||
    command.type === 'goToBookmark'
  );
}

function hasBookmark(surface: PaginatedSurface, name: string): boolean {
  const key = bookmarkNameKey(name);
  return surface.bookmarkEditing.list().some((bookmark) => bookmarkNameKey(bookmark.name) === key);
}

/** Why a bookmark command cannot run now, or null for any other command or an allowed one. */
export function bookmarkCommandRefusal(
  surface: PaginatedSurface,
  command: EditorCommand
): Extract<CanResult, { ok: false }> | null {
  if (!isBookmarkCommand(command)) return null;
  if (command.type === 'insertBookmark') {
    const invalid = bookmarkNameRefusal(command.name);
    if (invalid) return { ok: false, code: 'invalidArgs', reason: invalid };
    const refusal = surface.bookmarkEditing.insertRefusal(command.name);
    return refusal ? { ok: false, code: 'locked', reason: refusal } : null;
  }
  if (!hasBookmark(surface, command.name)) {
    return { ok: false, code: 'notFound', reason: 'the document has no bookmark with that name' };
  }
  return null;
}

/**
 * `openBookmarkDialog`: ask the host's Bookmark dialog chrome to open. `run` false only asks
 * whether it would. A view request, so it works in a read-only document.
 */
export function bookmarkDialogResult(
  chrome: { readonly bookmarkDialog: { canOpen(): boolean; open(): boolean } },
  destroyed: boolean,
  run: boolean
): ExecResult {
  if (destroyed) return { ok: false, code: 'notFound', reason: 'the editor was destroyed' };
  if (!chrome.bookmarkDialog.canOpen())
    return { ok: false, code: 'unsupported', reason: 'no bookmark dialog is registered' };
  if (run) chrome.bookmarkDialog.open();
  return { ok: true, changed: false };
}

/** Run a bookmark command the gate admitted. */
export function execBookmarkCommand(
  surface: PaginatedSurface,
  command: BookmarkCommand
): ExecResult {
  const refusal = bookmarkCommandRefusal(surface, command);
  if (refusal) return refusal;
  if (command.type === 'goToBookmark') {
    return surface.bookmarkEditing.goTo(command.name)
      ? { ok: true, changed: false }
      : { ok: false, code: 'unsupported', reason: 'the bookmark cannot be shown' };
  }
  const done =
    command.type === 'insertBookmark'
      ? surface.bookmarkEditing.insert(command.name)
      : surface.bookmarkEditing.remove(command.name);
  return done
    ? { ok: true, changed: true }
    : {
        ok: false,
        code: 'unsupported',
        reason: surface.state().lastRejection ?? `${command.type} was refused`,
      };
}
