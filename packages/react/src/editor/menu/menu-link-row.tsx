// The `text.link` slot as a menu row.
//
// `text.link` has no engine command: a link needs a target, and only the link popover can
// supply one. So this row does what `Toolbar.Link` and Ctrl/Cmd+K do: it opens the one shared
// popover for the selection. `MenuItem` routes `slotId="text.link"` here, so the context
// menu's packaged row, `<ContextMenu.Slot slotId="text.link" />` and
// `<Menu.Item slotId="text.link" />` are all the same working row.

import { chromeProbeForSlot } from '@docx-editor.dev/core/editor';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { localizeDisabledReason } from '@docx-editor.dev/i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { useHyperlinkPopup } from '../useHyperlinkPopup';
import { chromeControlForSlot, chromeIcon } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { MenuRow, type MenuItemBaseProps } from './parts';

const selectSelection = (snapshot: EditorSnapshot) => snapshot.selection;

/**
 * Insert link, or Edit link when the caret is inside a link.
 *
 * The label follows what the row opens: on an existing link the popover opens in edit mode,
 * so a row that said "Insert link" there promised something else. A field-result link opens
 * the read-only panel, which offers no editing, so it keeps the insert label.
 *
 * @internal
 */
export function MenuLinkRow({ labelKey, shortcutKey, className, hidden }: MenuItemBaseProps) {
  const editor = useDocxEditor();
  const menu = useMenuContext();
  const label = useMenuLabel();
  const { openAtCaret } = useHyperlinkPopup();
  // The label and the enabled state both depend on where the caret is.
  useEditorState(selectSelection);
  if (hidden) return null;
  const probe = chromeProbeForSlot('text.link');
  const allowed = editor && probe ? editor.can(probe) : null;
  const reason = localizeDisabledReason(allowed && !allowed.ok ? allowed.reason : null, label);
  const control = chromeControlForSlot('text.link');
  const onLink = editor?.surface?.hyperlinks.linkAtCaret() != null;
  const text = label(labelKey ?? (onLink ? 'hyperlinkPopup.editLink' : 'formattingBar.insertLink'));
  return (
    <MenuRow
      icon={chromeIcon(control?.paths)}
      slot="text.link"
      {...(shortcutKey ? { shortcut: label(shortcutKey) } : {})}
      disabled={allowed?.ok !== true}
      title={reason ?? undefined}
      onSelect={() => {
        // Close first: closing puts focus back in the document, and the popover then moves
        // it to its URL field. The other order would take focus away from the open panel.
        menu.setOpenMenu(null);
        openAtCaret();
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}
