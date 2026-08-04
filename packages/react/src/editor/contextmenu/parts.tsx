// The context menu's rows.
//
// THE ROWS ARE THE MENU BAR'S ROWS. `MenuRow` (presentation), `MenuItem` (a chrome slot as
// a live row), `MenuSubmenu` and `MenuSeparator` are re-exported here rather than
// reimplemented: a right-click row and a menu-bar row are the same object down to the
// `aria-disabled`-with-the-engine's-reason treatment, and a second implementation would be
// a second place for that to drift. What this file adds is the one kind of row the menu bar
// has no need for — a row bound to an `EditorCommand` that no chrome slot names.
//
// WHY NOT SLOTS. Cut, Copy, Paste, Delete and Select All are not in `CHROME_GROUPS`, and
// putting them there would place five controls in the default toolbar arrangement that
// nothing renders. They pass a fixed `EditorCommand` to `useEditorCommand` instead, which
// takes either form — the slot arm asks `toolbarCommandState`, the command arm asks
// `Editor.can`/`isActive` directly, and both end at the same authority.

import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { EditorCommand } from '@docx-editor.dev/core-contract/contracts/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { MenuRow } from '../menu/parts';
import { useMenuLabel } from '../menu/menu-context';
import { useContextMenuContext } from './contextmenu-context';
import {
  COPY_PATHS,
  CUT_PATHS,
  DELETE_PATHS,
  PASTE_PATHS,
  SELECT_ALL_PATHS,
} from './contextmenu-icons';
import { chromeIcon } from '../toolbar/ToolbarButton';

// ─────────────────────────────────────────────────────────────────────────────
// The generic command row
// ─────────────────────────────────────────────────────────────────────────────

/** Props for a packaged context-menu row. @public */
export interface ContextMenuCommandProps {
  /** Icon override. Defaults to the row's own Material Symbol. */
  icon?: ReactNode;
  /** i18n key for the label, overriding the packaged one. */
  labelKey?: string;
  /** i18n key for the shortcut column, overriding the packaged one. */
  shortcutKey?: string;
  className?: string;
  /** Render nothing — inside the default set this removes the row. */
  hidden?: boolean;
}

/**
 * Define a row bound to a fixed command.
 *
 * The `docxRow` static is the marker the default set's in-place override reads, the same
 * way the toolbar reads `docxSlot` and the menu bar reads `docxMenuRow`. Never
 * `displayName`, which minifies away.
 */
function defineCommandRow(
  rowId: string,
  command: EditorCommand,
  defaults: { labelKey: string; shortcutKey: string; paths: readonly string[] }
) {
  const Part = ({ icon, labelKey, shortcutKey, className, hidden }: ContextMenuCommandProps) => {
    const editor = useDocxEditor();
    const { close } = useContextMenuContext();
    const label = useMenuLabel();
    const { isEnabled, disabledReason } = useEditorCommand(command);
    if (hidden) return null;
    return (
      <MenuRow
        slot={rowId}
        icon={icon ?? chromeIcon(defaults.paths)}
        shortcut={label(shortcutKey ?? defaults.shortcutKey)}
        disabled={!isEnabled}
        {...(disabledReason ? { title: disabledReason } : {})}
        onSelect={() => {
          editor?.exec(command);
          close(true);
        }}
        {...(className ? { className } : {})}
      >
        {label(labelKey ?? defaults.labelKey)}
      </MenuRow>
    );
  };
  return Object.assign(Part, { docxRow: rowId });
}

/** Cut the selection to the clipboard. Disabled with the engine's reason when nothing is selected. @public */
export const ContextMenuCut = defineCommandRow(
  'edit.cut',
  { type: 'cut' },
  { labelKey: 'contextMenu.cut', shortcutKey: 'contextMenu.cutShortcut', paths: CUT_PATHS }
);

/** Copy the selection. Stays available in a read-only document. @public */
export const ContextMenuCopy = defineCommandRow(
  'edit.copy',
  { type: 'copy' },
  { labelKey: 'contextMenu.copy', shortcutKey: 'contextMenu.copyShortcut', paths: COPY_PATHS }
);

/** Delete the selection. @public */
export const ContextMenuDelete = defineCommandRow(
  'edit.delete',
  { type: 'deleteText' },
  { labelKey: 'contextMenu.delete', shortcutKey: 'contextMenu.deleteShortcut', paths: DELETE_PATHS }
);

/** Select the whole body. @public */
export const ContextMenuSelectAll = defineCommandRow(
  'edit.selectAll',
  { type: 'selectAll' },
  {
    labelKey: 'contextMenu.selectAll',
    shortcutKey: 'contextMenu.selectAllShortcut',
    paths: SELECT_ALL_PATHS,
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Paste — the one row that reaches outside the engine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Paste the clipboard's text at the selection.
 *
 * THE ROW READS THE CLIPBOARD, not the engine. `exec` is synchronous and clipboard read is
 * not — it prompts in Chrome and is refused outright by Firefox and Safari — so the read
 * happens here, inside the click that asked for it, where the permission gesture belongs,
 * and the text goes to the engine as an argument.
 *
 * Nothing can know whether the read will succeed BEFORE it is attempted, so the row starts
 * enabled (when the engine would accept a paste at all) and disables itself, with the
 * browser's own reason, once a read has actually been refused. Guessing the answer up front
 * would either grey out a working Paste on Chrome or advertise a dead one on Safari.
 *
 * @public
 */
export function ContextMenuPaste({
  icon,
  labelKey,
  shortcutKey,
  className,
  hidden,
}: ContextMenuCommandProps) {
  const editor = useDocxEditor();
  const { close, clipboardRefusal, reportClipboardRefusal } = useContextMenuContext();
  const label = useMenuLabel();
  // A single space probes the SHAPE and the mode — is a paste admissible here at all —
  // without claiming to know what the clipboard holds. NOT the empty string: `paste` with
  // no text still replaces the selection, so an empty probe asks about a destructive edit.
  const probe = useMemo((): EditorCommand => ({ type: 'paste', text: ' ' }), []);
  const { isEnabled, disabledReason } = useEditorCommand(probe);
  if (hidden) return null;
  const blocked = clipboardRefusal !== null;
  return (
    <MenuRow
      slot="edit.paste"
      icon={icon ?? chromeIcon(PASTE_PATHS)}
      shortcut={label(shortcutKey ?? 'contextMenu.pasteShortcut')}
      disabled={!isEnabled || blocked}
      {...((clipboardRefusal ?? disabledReason)
        ? { title: clipboardRefusal ?? disabledReason ?? '' }
        : {})}
      onSelect={() => {
        void (async () => {
          try {
            const text = await navigator.clipboard.readText();
            // An empty clipboard is not a refusal — there is simply nothing to insert.
            if (text) editor?.exec({ type: 'paste', text });
          } catch (error) {
            reportClipboardRefusal(
              error instanceof Error ? error.message : 'the clipboard is not readable'
            );
          } finally {
            close(true);
          }
        })();
      }}
      {...(className ? { className } : {})}
    >
      {label(labelKey ?? 'contextMenu.paste')}
    </MenuRow>
  );
}

ContextMenuPaste.docxRow = 'edit.paste' as const;

// ─────────────────────────────────────────────────────────────────────────────
// The host's own row
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.ContextMenu.Item`: a host-owned row. @public */
export interface ContextMenuItemProps {
  /**
   * Label, as a resolved STRING rather than an i18n key — the row belongs to the host's own
   * action, so the host's own catalogue resolves it. The packaged rows go the other way.
   */
  label: string;
  icon?: ReactNode;
  /** Right-aligned shortcut text, already resolved. */
  shortcut?: string;
  disabled?: boolean;
  /** Tooltip when disabled. Say why — never invent a reason the engine did not give. */
  disabledReason?: string;
  /** Checked state, for a row that toggles. Leave undefined on a row that just acts. */
  active?: boolean;
  onSelect?: () => void;
  className?: string;
}

/**
 * A host-owned context-menu row, styled and behaved like the packaged ones.
 *
 * The toolbar's `Action` for the right-click surface: no slot, no command, no engine wiring
 * — enabled state and the action are the host's, because the engine has no opinion about an
 * action it does not model. Selecting it closes the menu.
 *
 * @public
 */
export function ContextMenuItem({
  label,
  icon,
  shortcut,
  disabled,
  disabledReason,
  active,
  onSelect,
  className,
}: ContextMenuItemProps) {
  const { close } = useContextMenuContext();
  return (
    <MenuRow
      {...(icon ? { icon } : {})}
      {...(shortcut ? { shortcut } : {})}
      {...(disabled ? { disabled } : {})}
      {...(disabled && disabledReason ? { title: disabledReason } : {})}
      {...(active !== undefined ? { active } : {})}
      onSelect={() => {
        onSelect?.();
        close(true);
      }}
      {...(className ? { className } : {})}
    >
      {label}
    </MenuRow>
  );
}
