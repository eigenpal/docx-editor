// The `text.link` slot as a menu row; the React twin states the full design.
//
// `text.link` has no engine command: only the link popover can supply a target. This row
// opens the one shared popover for the selection, as `Toolbar.Link` and Ctrl/Cmd+K do.
// `MenuItem` routes `slot-id="text.link"` here, so the context menu's packaged row,
// `<ContextMenu.Slot slot-id="text.link" />` and `<Menu.Item slot-id="text.link" />` are the
// same working row.

import { defineComponent } from 'vue';
import { chromeProbeForSlot } from '@docx-editor.dev/core/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useDocxEditor, useEditorStateTick } from '../context';
import { useHyperlinkPopup } from '../useHyperlinkPopup';
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
    // The label and the enabled state both depend on where the caret is.
    const stateTick = useEditorStateTick();
    const menu = useMenuContext();
    const label = useMenuLabel();
    const { openAtCaret } = useHyperlinkPopup();
    return () => {
      void stateTick.value;
      if (props.hidden) return null;
      const probe = chromeProbeForSlot('text.link');
      const allowed = editor.value && probe ? editor.value.can(probe) : null;
      const reason = localizeDisabledReason(allowed && !allowed.ok ? allowed.reason : null, label);
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
          disabled={allowed?.ok !== true}
          title={reason ?? undefined}
          selectHandler={() => {
            // Close first: closing puts focus back in the document, and the popover then
            // moves it to its URL field. The other order would take focus away from the panel.
            menu.value.setOpenMenu(null);
            openAtCaret();
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {{ default: () => text }}
        </MenuRow>
      );
    };
  },
});
