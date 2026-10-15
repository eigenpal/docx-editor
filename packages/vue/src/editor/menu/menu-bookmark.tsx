// Insert › Bookmark. Kept in its own file, so the menu parts file stays under its line cap.

import { defineComponent } from 'vue';
import { isApplePlatform } from '@docx-editor.dev/i18n';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { useEditorCommand } from '../useEditorCommand';
import { MenuItem } from './parts';

/** The Go To chord's request: refused while the Go To UI turned its shortcut off. */
const GO_TO_CHORD: EditorCommand = { type: 'openGoTo', fromShortcut: true };

/**
 * Insert › Go To Bookmark…, the Vue twin of the React row: the Go To chord in the shortcut
 * column while the chord opens Go To, and none when a host turned the shortcut off.
 *
 * @internal
 */
export const MenuGoToBookmarkRow = defineComponent({
  name: 'MenuGoToBookmarkRow',
  setup() {
    const chord = useEditorCommand(GO_TO_CHORD);
    const shortcutKey = isApplePlatform()
      ? 'toolbar.goToBookmarkShortcutApple'
      : 'toolbar.goToBookmarkShortcut';
    return () => (
      <MenuItem slotId="insert.goToBookmark" {...(chord.isEnabled.value ? { shortcutKey } : {})} />
    );
  },
});

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
