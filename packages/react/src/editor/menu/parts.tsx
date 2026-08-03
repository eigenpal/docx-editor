// The menu bar's rows.
//
// A row is PRESENTATION over a chrome slot: the icon, the label and the enabled state all
// come from the registry entry the row names, exactly like a toolbar button, so the same
// capability cannot describe itself differently in two places. What differs is the shape
// (icon, label, right-aligned shortcut, submenu caret) and the fact that selecting a row
// closes the menu.
//
// THREE ROWS DO NOT DISPATCH A COMMAND. Open and save move BYTES across the host
// boundary, and page setup needs a dialog's values; the engine has no command for any of
// them (`toolbarCommandState` says so in those words). Those rows read their handler from
// the menu context, which the root resolves once — host override, else the packaged
// default — so the row itself holds no policy.

import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CHROME_MENUS,
  chromeProbeForSlot,
  commandForSlot,
  type ChromeMenuEntry,
  type ChromeMenuId,
  type ChromeSlotId,
} from '@docx-editor.dev/core-contract/editor';
import { useDocxEditor } from '../context';
import { openReportIssue } from '../../lib/reportIssue';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';

/** Word's insert-table grid is 6 columns by 6 rows. */
const TABLE_GRID_COLUMNS = 6;
const TABLE_GRID_ROWS = 6;

// ─────────────────────────────────────────────────────────────────────────────
// The generic row
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Row`: one presentational menu row. @public */
export interface MenuRowProps {
  /** Material Symbols paths, rendered as inline SVG in the row's icon column. */
  icon?: ReactNode;
  /** Right-aligned shortcut text (already resolved). */
  shortcut?: string;
  disabled?: boolean;
  /**
   * Tooltip. Set it for the ENGINE's disabled reason and nothing else — a menu row's text
   * is already visible, so a tooltip repeating it is noise, and inventing a reason for a
   * refusal the engine explained is the thing this codebase does not do.
   */
  title?: string;
  /**
   * Checked state, for a row that TOGGLES (bold on bold text). Leave undefined on a row
   * that just acts: `menuitemcheckbox` with `aria-checked="false"` announces "not
   * selected" on a Page break row, which is a claim about state it does not have.
   */
  active?: boolean;
  /** Stable marker for hosts, tests and e2e. */
  slot?: string;
  onSelect?: () => void;
  className?: string;
  children?: ReactNode;
}

/**
 * One menu row: icon column, label, shortcut column.
 *
 * The icon column is reserved even when a row has no icon, so labels line up down the
 * panel the way Word's and Docs' menus do.
 *
 * @public
 */
export function MenuRow(props: MenuRowProps) {
  const { icon, shortcut, disabled, title, active, slot, onSelect, className, children } = props;
  return (
    <button
      type="button"
      className={`docx-toolbar__menu-item docx-menubar__item${className ? ` ${className}` : ''}`}
      disabled={disabled}
      {...(slot ? { 'data-slot': slot } : {})}
      {...(active ? { 'data-active': '' } : {})}
      {...(disabled ? { 'data-disabled': '' } : {})}
      {...(active === undefined
        ? { role: 'menuitem' as const }
        : { role: 'menuitemcheckbox' as const, 'aria-checked': active })}
      {...(title ? { title } : {})}
      onMouseDown={guardToolbarMousedown}
      onClick={onSelect}
    >
      <span className="docx-menubar__item-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="docx-menubar__item-label">{children}</span>
      {shortcut ? <span className="docx-menubar__item-shortcut">{shortcut}</span> : null}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot-driven row
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Item`: one chrome slot as a menu row. @public */
export interface MenuItemProps {
  /** The chrome slot this row drives (`'text.bold'`, `'insert.pageBreak'`, …). */
  slot: ChromeSlotId;
  /** Plain-label i18n key, overriding the slot's tooltip-shaped one. */
  labelKey?: string;
  /** i18n key of the shortcut shown in the right column. */
  shortcutKey?: string;
  className?: string;
  /** Render nothing — inside a packaged menu this removes the row. */
  hidden?: boolean;
}

/**
 * One chrome slot as a live menu row: enabled and active from the engine's
 * can-before-exec answer, labelled and iconed from the registry. Selecting it runs the
 * slot's command and closes the menu.
 *
 * @public
 */
export function MenuItem({ slot, labelKey, shortcutKey, className, hidden }: MenuItemProps) {
  const { execute, isActive, isEnabled, disabledReason } = useEditorCommand(slot);
  const { setOpenMenu } = useMenuContext();
  const label = useMenuLabel();
  if (hidden) return null;
  const control = chromeControlForSlot(slot);
  const text = label(labelKey ?? control?.labelKey ?? slot);
  // Checked-ness only where it is meaningful — the same rule `ToolbarButton` applies to
  // `aria-pressed`: marks and alignment toggle, a break insert does not.
  const command = commandForSlot(slot);
  const isToggle = command?.type === 'toggleMark' || command?.type === 'setAlignment';
  return (
    <MenuRow
      slot={slot}
      icon={chromeIcon(control?.paths)}
      {...(shortcutKey ? { shortcut: label(shortcutKey) } : {})}
      disabled={!isEnabled}
      {...(disabledReason ? { title: disabledReason } : {})}
      {...(isToggle ? { active: isActive } : {})}
      onSelect={() => {
        execute();
        setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The three host-boundary rows: open, save, page setup
// ─────────────────────────────────────────────────────────────────────────────

/** Props for the pinned File rows. @public */
export interface MenuActionProps {
  className?: string;
  hidden?: boolean;
}

/**
 * A row whose action comes from the menu context rather than from a command, with the
 * slot still supplying label, icon and shortcut. Disabled when the root resolved no
 * handler, which is the honest state: the capability exists, this chrome cannot reach it.
 */
function defineActionRow(
  slot: ChromeSlotId,
  labelKey: string | undefined,
  shortcutKey: string | undefined,
  pick: (context: ReturnType<typeof useMenuContext>) => (() => void) | undefined
) {
  const Part = ({ className, hidden }: MenuActionProps) => {
    const context = useMenuContext();
    const label = useMenuLabel();
    const handler = pick(context);
    if (hidden) return null;
    const control = chromeControlForSlot(slot);
    const text = label(labelKey ?? control?.labelKey ?? slot);
    return (
      <MenuRow
        slot={slot}
        icon={chromeIcon(control?.paths)}
        {...(shortcutKey ? { shortcut: label(shortcutKey) } : {})}
        disabled={!handler}
        onSelect={() => {
          handler?.();
          context.setOpenMenu(null);
        }}
        {...(className ? { className } : {})}
      >
        {text}
      </MenuRow>
    );
  };
  return Object.assign(Part, { docxSlot: slot });
}

export const MenuOpen = defineActionRow(
  'file.open',
  'toolbar.open',
  'toolbar.openShortcut',
  (context) => context.onOpen
);
export const MenuSave = defineActionRow(
  'file.save',
  'toolbar.save',
  'toolbar.saveShortcut',
  (context) => context.onSave
);

/**
 * Page setup. Unlike open and save, the ENGINE has an opinion here — `setPageSetup` is a
 * real command, it just needs the dialog's values — so the row asks through the slot's
 * probe and is disabled with the engine's own words on a document it cannot rewrite.
 */
function MenuPageSetupImpl({ className, hidden }: MenuActionProps) {
  const editor = useDocxEditor();
  const context = useMenuContext();
  const label = useMenuLabel();
  const probe = chromeProbeForSlot('file.pageSetup');
  const allowed = editor && probe ? editor.can(probe) : null;
  const engineOk = allowed?.ok === true;
  const engineReason = allowed && !allowed.ok ? allowed.reason : null;
  if (hidden) return null;
  const control = chromeControlForSlot('file.pageSetup');
  const text = label(control?.labelKey ?? 'file.pageSetup');
  const enabled = engineOk && !!context.onPageSetup;
  return (
    <MenuRow
      slot="file.pageSetup"
      icon={chromeIcon(control?.paths)}
      disabled={!enabled}
      {...(engineReason ? { title: engineReason } : {})}
      onSelect={() => {
        context.onPageSetup?.();
        context.setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}

export const MenuPageSetup = Object.assign(MenuPageSetupImpl, {
  docxSlot: 'file.pageSetup' as ChromeSlotId,
});

// ─────────────────────────────────────────────────────────────────────────────
// Submenu
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Submenu`. @public */
export interface MenuSubmenuProps {
  /** i18n key of the parent row's label. */
  labelKey: string;
  /** Material Symbols paths for the parent row's icon. */
  paths?: readonly string[] | null;
  className?: string;
  children?: ReactNode;
}

/**
 * A row that opens a nested panel to its right (Insert › Break).
 *
 * The parent row runs nothing — disclosure is not a command — so it stays interactive
 * regardless of what its children can do, and each child answers for itself. Opening on
 * hover AND on click is what both Word and Docs do; keyboard users get the same panel
 * through focus.
 *
 * @public
 */
export function MenuSubmenu({ labelKey, paths, className, children }: MenuSubmenuProps) {
  const label = useMenuLabel();
  const [open, setOpen] = useState(false);
  const text = label(labelKey);
  return (
    <div
      className={`docx-menubar__submenu${className ? ` ${className}` : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        className="docx-toolbar__menu-item docx-menubar__item"
        {...(open ? { 'data-open': '' } : {})}
        onMouseDown={guardToolbarMousedown}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="docx-menubar__item-icon" aria-hidden="true">
          {chromeIcon(paths)}
        </span>
        <span className="docx-menubar__item-label">{text}</span>
        <span className="docx-menubar__item-caret" aria-hidden="true">
          ›
        </span>
      </button>
      {open ? (
        <div
          className="docx-toolbar__menu docx-menubar__menu docx-menubar__submenu-panel"
          role="menu"
          aria-label={text}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The insert-table grid
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.TableGrid`. @public */
export interface MenuTableGridProps {
  /** The slot the picked size dispatches through. Defaults to `table.insert`. */
  slot?: ChromeSlotId;
  className?: string;
}

/**
 * Word's insert-table size picker: a 6×6 grid that highlights as the pointer sweeps it
 * and reads back the size underneath.
 *
 * The PARENT row discloses this panel and is therefore always interactive; the CELLS
 * carry the engine's answer, so on an engine that cannot insert a table yet the grid is
 * visible, sweeps, and refuses — a panel that opens onto a working-looking grid whose
 * click silently did nothing would be the lie. The reason under the grid is the engine's.
 *
 * @public
 */
export function MenuTableGrid({ slot = 'table.insert', className }: MenuTableGridProps) {
  const editor = useDocxEditor();
  const { isEnabled, disabledReason } = useEditorCommand(slot);
  const { setOpenMenu } = useMenuContext();
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);

  const insert = useCallback(
    (rows: number, cols: number) => {
      if (!editor || !isEnabled) return;
      const command = { type: 'insertTable' as const, rows, cols };
      if (editor.can(command).ok) editor.exec(command);
      setOpenMenu(null);
    },
    [editor, isEnabled, setOpenMenu]
  );

  const cells: ReactNode[] = [];
  for (let row = 1; row <= TABLE_GRID_ROWS; row += 1) {
    for (let col = 1; col <= TABLE_GRID_COLUMNS; col += 1) {
      const filled = !!hover && row <= hover.rows && col <= hover.cols;
      cells.push(
        <button
          key={`${row}x${col}`}
          type="button"
          role="menuitem"
          className="docx-menubar__grid-cell"
          disabled={!isEnabled}
          {...(filled ? { 'data-filled': '' } : {})}
          aria-label={`${col} × ${row}`}
          onMouseDown={guardToolbarMousedown}
          onMouseEnter={() => setHover({ rows: row, cols: col })}
          onFocus={() => setHover({ rows: row, cols: col })}
          onClick={() => insert(row, col)}
        />
      );
    }
  }

  return (
    <div
      className={`docx-menubar__grid${className ? ` ${className}` : ''}`}
      onMouseLeave={() => setHover(null)}
    >
      <div
        className="docx-menubar__grid-cells"
        style={{ gridTemplateColumns: `repeat(${TABLE_GRID_COLUMNS}, 1fr)` }}
      >
        {cells}
      </div>
      <div className="docx-menubar__grid-caption" role="status">
        {hover ? `${hover.cols} × ${hover.rows}` : ''}
      </div>
      {!isEnabled && disabledReason ? (
        <div className="docx-menubar__grid-reason">{disabledReason}</div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Separator, and the registry-driven entry renderer
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Separator`. @public */
export interface MenuSeparatorProps {
  className?: string;
}

/** A horizontal rule between groups of rows. @public */
export function MenuSeparator({ className }: MenuSeparatorProps) {
  return (
    <div
      role="separator"
      className={`docx-toolbar__menu-separator${className ? ` ${className}` : ''}`}
    />
  );
}

/**
 * One registry entry as its row.
 *
 * The three host-boundary slots route to their pinned parts rather than to the generic
 * `MenuItem`, because a command-driven row would render them permanently disabled — the
 * engine reports, correctly, that neither open nor save is a command.
 */
export function MenuEntry({ entry }: { entry: ChromeMenuEntry }) {
  if (entry.kind === 'separator') return <MenuSeparator />;
  if (entry.kind === 'submenu') {
    return (
      <MenuSubmenu labelKey={entry.labelKey} paths={entry.paths}>
        {entry.items.map((item, index) => (
          <MenuEntry key={index} entry={item} />
        ))}
      </MenuSubmenu>
    );
  }
  if (entry.slot === 'file.open') return <MenuOpen />;
  if (entry.slot === 'file.save') return <MenuSave />;
  if (entry.slot === 'file.pageSetup') return <MenuPageSetup />;
  if (entry.picker === 'tableGrid') {
    const control = chromeControlForSlot(entry.slot);
    return (
      <MenuSubmenu
        labelKey={entry.labelKey ?? control?.labelKey ?? entry.slot}
        paths={control?.paths}
      >
        <MenuTableGrid slot={entry.slot} />
      </MenuSubmenu>
    );
  }
  return (
    <MenuItem
      slot={entry.slot}
      {...(entry.labelKey ? { labelKey: entry.labelKey } : {})}
      {...(entry.shortcutKey ? { shortcutKey: entry.shortcutKey } : {})}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One menu: trigger + panel
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Menu` and the four pinned menu parts. @public */
export interface MenuProps {
  /** Which menu this is. Only one panel in the bar is open at a time, keyed on this. */
  id: ChromeMenuId;
  /** i18n key of the trigger label. Defaults to the registry's. */
  labelKey?: string;
  className?: string;
  /** Render nothing — inside the default bar this removes the menu. */
  hidden?: boolean;
  /** Panel content. Defaults to the registry's rows for this menu. */
  children?: ReactNode;
}

/**
 * One menu of the bar: a trigger and the panel it opens.
 *
 * Bar behaviour is Docs': a click opens, a second click closes, and while ANY menu is
 * open, moving the pointer over a different trigger switches to it without a click.
 *
 * @public
 */
export function Menu({ id, labelKey, className, hidden, children }: MenuProps) {
  const { openMenu, setOpenMenu } = useMenuContext();
  const label = useMenuLabel();
  const panelId = useId();
  const registry = CHROME_MENUS.find((menu) => menu.id === id);
  const open = openMenu === id;
  if (hidden) return null;
  const text = label(labelKey ?? registry?.labelKey ?? id);
  const rows =
    children ?? registry?.entries.map((entry, index) => <MenuEntry key={index} entry={entry} />);
  return (
    <div className={`docx-menubar__menu-root${className ? ` ${className}` : ''}`} data-menu={id}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="docx-menubar__trigger"
        {...(open ? { 'data-open': '' } : {})}
        onMouseDown={guardToolbarMousedown}
        onClick={() => setOpenMenu(open ? null : id)}
        // Docs' bar behaviour: once a menu is open the bar tracks the pointer, so
        // sliding across the triggers browses the menus without further clicks.
        onMouseEnter={() => {
          if (openMenu !== null) setOpenMenu(id);
        }}
      >
        {text}
      </button>
      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label={text}
          className="docx-toolbar__menu docx-menubar__menu"
        >
          {rows}
        </div>
      ) : null}
    </div>
  );
}

/** A menu pinned to one registry id, for `DocxEditor.Menu.File` and friends. @public */
export interface MenuPartComponent {
  (props: Omit<MenuProps, 'id'>): ReactNode;
  readonly docxMenu: ChromeMenuId;
}

function defineMenu(id: ChromeMenuId): MenuPartComponent {
  const Part = (props: Omit<MenuProps, 'id'>) => <Menu id={id} {...props} />;
  return Object.assign(Part, { docxMenu: id });
}

export const MenuFile = defineMenu('file');
export const MenuFormat = defineMenu('format');
export const MenuInsert = defineMenu('insert');

/**
 * Help.
 *
 * The registry leaves this menu EMPTY on purpose — a product's documentation and support
 * channel are the host's, not the library's. The one row the library can honestly own is
 * a report for this project's own tracker, so the packaged Help menu supplies it here
 * rather than in the shared registry, where a Vue or vanilla host would inherit a link it
 * never asked for. Replace the whole menu by name to say something else.
 */
function MenuHelpImpl({ children, ...rest }: Omit<MenuProps, 'id'>) {
  const { setOpenMenu } = useMenuContext();
  const label = useMenuLabel();
  return (
    <Menu id="help" {...rest}>
      {children ?? (
        <MenuRow
          onSelect={() => {
            openReportIssue();
            setOpenMenu(null);
          }}
        >
          {label('toolbar.reportIssue')}
        </MenuRow>
      )}
    </Menu>
  );
}

export const MenuHelp: MenuPartComponent = Object.assign(MenuHelpImpl, {
  docxMenu: 'help' as ChromeMenuId,
});
