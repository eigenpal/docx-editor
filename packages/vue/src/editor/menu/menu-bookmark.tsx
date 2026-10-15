// Insert › Bookmark. Kept in its own file, so the menu parts file stays under its line cap.

import { defineComponent } from 'vue';
import { chromeProbeForSlot } from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { MenuRow, menuRowSlot } from './parts';

/**
 * The Bookmark dialog, from the Insert menu. The Vue twin of the React row.
 *
 * Same shape as Watermark: no fixed command to dispatch, so the row asks through the slot's
 * probe. The dialog itself asks the engine before each Add and Delete.
 */
const MenuBookmarkImpl = defineComponent({
  name: 'MenuBookmarkImpl',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const command = useEditorCommand(chromeProbeForSlot('insert.bookmark')!);
    const menuContext = useMenuContext();
    const label = useMenuLabel();
    return () => {
      if (props.hidden) return null;
      const context = menuContext.value;
      const engineReason = command.disabledReason.value;
      const control = chromeControlForSlot('insert.bookmark');
      const text = label(control?.labelKey ?? 'toolbar.bookmark');
      const enabled = command.isEnabled.value && !!context.onBookmarkDialog;
      return (
        <MenuRow
          {...menuRowSlot('insert.bookmark')}
          icon={chromeIcon(control?.paths) ?? undefined}
          disabled={!enabled}
          shortcut={label('toolbar.bookmarkShortcut')}
          {...(engineReason ? { title: engineReason } : {})}
          selectHandler={() => {
            context.onBookmarkDialog?.();
            context.setOpenMenu(null);
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {{ default: () => text }}
        </MenuRow>
      );
    };
  },
});

/** Insert › Bookmark, so a host can hide it or place it elsewhere by name. @public */
export const MenuBookmark = Object.assign(MenuBookmarkImpl, {
  docxSlot: 'insert.bookmark' as const,
});
