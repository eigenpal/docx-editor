// Insert › Bookmark. Kept in its own file, so the menu parts file stays under its line cap.

import { defineComponent } from 'vue';
import { MenuItem } from './parts';

/**
 * The Bookmark row, the Vue twin of the React row: an ordinary command row whose slot runs
 * `openBookmarkDialog`, the same request Ctrl/Cmd+Shift+F5 sends. Disabled while no bookmark
 * dialog is registered, for example when the `bookmark` popup is `false`.
 */
const MenuBookmarkImpl = defineComponent({
  name: 'MenuBookmarkImpl',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    return () => (
      <MenuItem
        slotId="insert.bookmark"
        shortcutKey="toolbar.bookmarkShortcut"
        {...(props.className ? { className: props.className } : {})}
        {...(props.hidden ? { hidden: true } : {})}
      />
    );
  },
});

/** Insert › Bookmark, so a host can hide it or place it elsewhere by name. @public */
export const MenuBookmark = Object.assign(MenuBookmarkImpl, {
  docxSlot: 'insert.bookmark' as const,
});
