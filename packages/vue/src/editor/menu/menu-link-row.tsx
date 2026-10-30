// The `text.link` slot as a menu row; the React twin states the full design.
//
// `text.link` runs no engine command: only a link UI can supply a target. The engine enables
// the slot while a link UI is registered, and running it opens that UI for the selection, as
// `Toolbar.Link` and Ctrl/Cmd+K do.
// `MenuItem` routes `slot-id="text.link"` here, so the context menu's packaged row,
// `<ContextMenu.Slot slot-id="text.link" />` and `<Menu.Item slot-id="text.link" />` are the
// same working row.

import { defineComponent } from 'vue';
import { runToolbarCommand, toolbarCommandState } from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useDocxEditor, useEditorStateTick } from '../context';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { MenuRow, menuRowSlot } from './parts';

/**
 * Insert link, or Edit link when the caret is inside a link. On an existing link the popover
 * opens in edit mode, so the label says so. A field-result link opens the read-only panel and
 * keeps the insert label.
 *
 * @internal
 */
export const MenuLinkRow = defineComponent({
  name: 'MenuLinkRow',
  props: {
    labelKey: { type: String, default: undefined },
    shortcutKey: { type: String, default: undefined },
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editor = useDocxEditor();
    // The label and the enabled state both depend on where the caret is, and the state on
    // whether a link UI is registered.
    const stateTick = useEditorStateTick();
    const menu = useMenuContext();
    const label = useMenuLabel();
    return () => {
      void stateTick.value;
      if (props.hidden) return null;
      const state = toolbarCommandState(editor.value, 'text.link');
      const reason = localizeDisabledReason(state.disabledReason, label);
      const control = chromeControlForSlot('text.link');
      const onLink = editor.value?.surface?.hyperlinks.linkAtCaret() != null;
      const text = label(
        props.labelKey ?? (onLink ? 'hyperlinkPopup.editLink' : 'formattingBar.insertLink')
      );
      return (
        <MenuRow
          {...menuRowSlot('text.link')}
          icon={chromeIcon(control?.paths) ?? undefined}
          {...(props.shortcutKey ? { shortcut: label(props.shortcutKey) } : {})}
          disabled={!state.enabled}
          title={reason ?? undefined}
          selectHandler={() => {
            // Close first: closing puts focus back in the document, and the popover then
            // moves it to its URL field. The other order would take focus away from the panel.
            menu.value.setOpenMenu(null);
            runToolbarCommand(editor.value, 'text.link');
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {{ default: () => text }}
        </MenuRow>
      );
    };
  },
});
