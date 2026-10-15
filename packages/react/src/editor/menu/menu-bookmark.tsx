// Insert › Bookmark. Kept in its own file, so the menu parts file stays under its line cap.

import { chromeProbeForSlot } from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { MenuRow, type MenuActionProps } from './parts';

/**
 * The Bookmark dialog, from the Insert menu.
 *
 * Same shape as Watermark: no fixed command to dispatch, so the row asks through the slot's
 * probe. The dialog itself asks the engine before each Add and Delete.
 */
function MenuBookmarkImpl({ className, hidden }: MenuActionProps) {
  const { isEnabled: engineOk, disabledReason: engineReason } = useEditorCommand(
    chromeProbeForSlot('insert.bookmark')!
  );
  const context = useMenuContext();
  const label = useMenuLabel();
  if (hidden) return null;
  const control = chromeControlForSlot('insert.bookmark');
  const text = label(control?.labelKey ?? 'toolbar.bookmark');
  const enabled = engineOk && !!context.onBookmarkDialog;
  return (
    <MenuRow
      slot="insert.bookmark"
      icon={chromeIcon(control?.paths)}
      disabled={!enabled}
      shortcut={label('toolbar.bookmarkShortcut')}
      {...(engineReason ? { title: engineReason } : {})}
      onSelect={() => {
        context.onBookmarkDialog?.();
        context.setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}

/** Insert › Bookmark, so a host can hide it or place it elsewhere by name. @public */
export const MenuBookmark = Object.assign(MenuBookmarkImpl, {
  docxSlot: 'insert.bookmark' as const,
});
