// Insert › Bookmark. Kept in its own file, so the menu parts file stays under its line cap.

import { MenuItem, type MenuActionProps } from './parts';

function MenuBookmarkImpl({ className, hidden }: MenuActionProps) {
  return (
    <MenuItem
      slotId="insert.bookmark"
      shortcutKey="toolbar.bookmarkShortcut"
      {...(className ? { className } : {})}
      {...(hidden ? { hidden } : {})}
    />
  );
}

/**
 * Insert › Bookmark, so a host can hide it or place it elsewhere by name.
 *
 * An ordinary command row: the slot runs `openBookmarkDialog`, which opens the `bookmark`
 * popup through the editor, the same request Ctrl/Cmd+Shift+F5 sends. The row is disabled
 * while no bookmark dialog is registered, for example when the popup is `false`.
 *
 * @public
 */
export const MenuBookmark = Object.assign(MenuBookmarkImpl, {
  docxSlot: 'insert.bookmark' as const,
});
