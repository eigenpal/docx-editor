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

import { isValidElement, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import { mergeArrangement, unwrapFragment } from '../merge-arrangement';
import type { ReactNode } from 'react';
import {
  CHROME_MENUS,
  chromeProbeForSlot,
  commandForSlot,
  type ChromeMenuEntry,
  type ChromeMenuId,
  type ChromeMenuItemEntry,
  type ChromeSlotId,
} from '@docx-editor.dev/core-contract/editor';
import { useDocxEditor } from '../context';
import { openReportIssue } from '../../lib/reportIssue';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel, type MenuId } from './menu-context';
import { focusBy, focusEdge, panelItems } from './menu-keyboard';
import { useImageInsert } from '../images/ImageInsert';

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
  /**
   * Present on a row belonging to a MUTUALLY EXCLUSIVE set (the four alignments), which
   * makes it `menuitemradio` rather than `menuitemcheckbox`. Four independent checkboxes
   * is a different claim from one-of-four, and a screen reader reads it as such.
   */
  selected?: true;
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
  const { icon, shortcut, disabled, title, active, selected, slot, onSelect, className, children } =
    props;
  const reasonId = useId();
  // `aria-disabled`, NOT the native attribute. A natively-disabled button leaves the tab
  // order and stops firing pointer events, so its `title` never renders and a screen
  // reader walking the menu skips the row entirely — which is the whole "present and
  // disabled, with the reason" design delivering nothing to the users who most need it.
  // The APG says a disabled menu item stays focusable for exactly this reason. The reason
  // itself rides `aria-describedby`, so it is ANNOUNCED rather than hover-only.
  const describe = disabled && title ? reasonId : undefined;
  const role =
    active === undefined
      ? 'menuitem'
      : selected === undefined
        ? 'menuitemcheckbox'
        : 'menuitemradio';
  return (
    <button
      type="button"
      role={role}
      className={`docx-toolbar__menu-item docx-menubar__item${className ? ` ${className}` : ''}`}
      // Every row is reachable by the menu's own arrow keys, never by Tab: one tab stop
      // per menu, which is the menu pattern (and what keeps a 36-cell grid from being 36
      // tab stops).
      tabIndex={-1}
      {...(slot ? { 'data-slot': slot } : {})}
      {...(active ? { 'data-active': '' } : {})}
      {...(disabled ? { 'data-disabled': '', 'aria-disabled': true } : {})}
      {...(active !== undefined ? { 'aria-checked': active } : {})}
      {...(describe ? { 'aria-describedby': describe } : {})}
      {...(title ? { title } : {})}
      onMouseDown={guardToolbarMousedown}
      onClick={disabled ? undefined : onSelect}
    >
      <span className="docx-menubar__item-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="docx-menubar__item-label">{children}</span>
      {shortcut ? <span className="docx-menubar__item-shortcut">{shortcut}</span> : null}
      {describe ? (
        <span id={reasonId} className="ep-sr-only">
          {title}
        </span>
      ) : null}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Grouping
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Group`: a titled section of rows. @public */
export interface MenuGroupProps {
  /** Literal heading, already resolved. Wins over {@link labelKey}. */
  label?: string;
  /** i18n key of the heading. */
  labelKey?: string;
  className?: string;
  hidden?: boolean;
  children?: ReactNode;
}

/**
 * A named section inside a panel: a visible heading and the rows under it.
 *
 * A separator says "these are apart"; a group says WHAT they are, which is the thing a panel
 * needs once a product adds rows of its own beside the packaged ones. Without it a host
 * either shipped an unlabelled separator or hand-rolled a heading — and a bare element
 * carrying no role inside `role="menu"` breaks the ownership assistive tech derives its item
 * counts from, so the hand-rolled version was always slightly wrong.
 *
 * `role="group"` is the ARIA answer: it nests legally inside a menu, keeps its rows owned,
 * and takes the heading as its accessible name. The visible heading is then decoration and
 * is hidden from the tree, so the name is announced once rather than read twice.
 *
 * @public
 */
export function MenuGroup({
  label: literal,
  labelKey,
  className,
  hidden,
  children,
}: MenuGroupProps) {
  const label = useMenuLabel();
  if (hidden) return null;
  const text = literal ?? (labelKey === undefined ? undefined : label(labelKey));
  return (
    <div
      role="group"
      className={`docx-menubar__group${className ? ` ${className}` : ''}`}
      {...(text ? { 'aria-label': text } : {})}
    >
      {text ? (
        <div className="docx-menubar__group-label" aria-hidden="true">
          {text}
        </div>
      ) : null}
      {children}
    </div>
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
  // The four alignments are one-of-four, not four independent toggles.
  const isRadio = command?.type === 'setAlignment';
  return (
    <MenuRow
      slot={slot}
      icon={chromeIcon(control?.paths)}
      {...(shortcutKey ? { shortcut: label(shortcutKey) } : {})}
      disabled={!isEnabled}
      {...(disabledReason ? { title: disabledReason } : {})}
      {...(isToggle ? { active: isActive } : {})}
      {...(isRadio ? { selected: true as const } : {})}
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

// The marker the panel's in-place override reads. `MenuItem` is generic, so its row
// identity is its `slot` PROP; the pinned parts below carry a fixed `docxSlot` static.
// Never displayName, which minifies away.
MenuItem.docxMenuRow = true as const;

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

function MenuImageInsertImpl({ className, hidden }: MenuActionProps) {
  const { openFilePicker, isEnabled, disabledReason } = useImageInsert();
  const context = useMenuContext();
  const label = useMenuLabel();
  if (hidden) return null;
  const control = chromeControlForSlot('image.insert');
  const text = label(control?.labelKey ?? 'toolbar.image');
  return (
    <MenuRow
      slot="image.insert"
      icon={chromeIcon(control?.paths)}
      disabled={!isEnabled}
      {...(disabledReason ? { title: disabledReason } : {})}
      onSelect={() => {
        openFilePicker();
        context.setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {text}
    </MenuRow>
  );
}

export const MenuImageInsert = Object.assign(MenuImageInsertImpl, {
  docxSlot: 'image.insert' as ChromeSlotId,
});

// ─────────────────────────────────────────────────────────────────────────────
// Submenu
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Submenu`. @public */
/** How close a floating panel may come to the window edge, in px. */
const EDGE_INSET = 8;

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
  const parentRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const text = label(labelKey);

  // PLACED IN CLIENT SPACE, not with `left: 100%`.
  //
  // The panel opens sideways, out of its parent's box, and the context menu is a SCROLLER:
  // `.docx-contextmenu` carries `max-height` plus `overflow-y: auto` so a menu taller than
  // the window stays reachable, and CSS forces the other axis to `auto` with it. An
  // absolutely positioned panel was therefore clipped at the parent's right edge — the row
  // highlighted, the panel mounted, and nothing appeared. Fixed positioning leaves the
  // scroller entirely; the same measurement also lets a panel near the right edge open
  // leftward instead of off-screen, which `left: 100%` could never do.
  const [box, setBox] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const row = parentRef.current;
    const panel = panelRef.current;
    const view = row?.ownerDocument.defaultView;
    if (!row || !panel || !view) return;
    const rect = row.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    // Right first, Word's geometry; left when the panel would not fit there.
    const flip = rect.right + width > view.innerWidth - EDGE_INSET;
    setBox({
      left: flip
        ? Math.max(EDGE_INSET, rect.left - width)
        : Math.min(rect.right, view.innerWidth - width - EDGE_INSET),
      // Top-aligned with the row, pulled back by the panel's own padding, then clamped so a
      // submenu on the last row of a tall menu does not hang below the fold.
      top: Math.max(EDGE_INSET, Math.min(rect.top - 4, view.innerHeight - height - EDGE_INSET)),
    });
  }, [open]);
  return (
    <div
      role="none"
      className={`docx-menubar__submenu${className ? ` ${className}` : ''}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(event) => {
        // The APG's submenu keys, and the reason the panel is reachable at all without a
        // pointer: Right opens and steps in, Left and Escape close and come back to the
        // parent row. Escape is stopped so it closes THIS panel rather than the whole bar.
        if (event.key === 'ArrowRight' && document.activeElement === parentRef.current) {
          event.preventDefault();
          setOpen(true);
          queueMicrotask(() => {
            if (panelRef.current) focusEdge(panelItems(panelRef.current), 'first');
          });
        } else if ((event.key === 'ArrowLeft' || event.key === 'Escape') && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          parentRef.current?.focus();
        }
      }}
      // Focus leaving the whole submenu closes it. Without this, a panel opened by
      // TABBING onto the parent stays open forever — `onMouseLeave` cannot fire for a
      // pointer that never arrived, and it then floats over the rows below it.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={parentRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="docx-toolbar__menu-item docx-menubar__item"
        tabIndex={-1}
        {...(open ? { 'data-open': '' } : {})}
        onMouseDown={guardToolbarMousedown}
        onFocus={() => setOpen(true)}
        // OPENS, never toggles. The pointer that clicked this row is already inside the
        // wrapper, so `onMouseEnter` has set `open` — a toggle would read the state hover
        // just wrote and close the panel the click was meant to open, and no further
        // `mouseEnter` fires while the pointer stays put. Closing is `onMouseLeave`'s and
        // the blur handler's job, which is also how Word and Docs behave.
        onClick={() => setOpen(true)}
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
          ref={panelRef}
          id={panelId}
          className="docx-toolbar__menu docx-menubar__menu docx-menubar__submenu-panel"
          role="menu"
          aria-label={text}
          // Hidden for the measuring pass only — it has to be in the DOM to have a size,
          // and one frame of a panel at the wrong place reads as a flicker.
          style={
            box
              ? { position: 'fixed', left: box.left, top: box.top }
              : { position: 'fixed', visibility: 'hidden' }
          }
          onKeyDown={(event) => {
            const panel = panelRef.current;
            if (!panel) return;
            const items = panelItems(panel);
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              event.stopPropagation();
              focusBy(items, document.activeElement, 1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              event.stopPropagation();
              focusBy(items, document.activeElement, -1);
            }
          }}
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
 * Rendered only when the engine will honour an insert (see `MenuTablePicker`). A panel
 * that opens onto a grid nothing can be picked from is worse than no panel: the row
 * cannot act, so it should not disclose — it should look disabled, like every other row
 * the engine refuses.
 *
 * @public
 */
export function MenuTableGrid({ slot = 'table.insert', className }: MenuTableGridProps) {
  const editor = useDocxEditor();
  const { isEnabled } = useEditorCommand(slot);
  const { setOpenMenu } = useMenuContext();
  const [hover, setHover] = useState<{ rows: number; cols: number } | null>(null);
  // The cell that holds the grid's single tab stop. A 6x6 of tabbable buttons is 36 tab
  // stops for a keyboard user; a grid is ONE, with arrows moving inside it.
  const [cursor, setCursor] = useState({ rows: 1, cols: 1 });
  const gridRef = useRef<HTMLDivElement | null>(null);

  const insert = useCallback(
    (rows: number, cols: number) => {
      if (!editor || !isEnabled) return;
      // can-before-exec even here: the panel opened because the slot was enabled, and the
      // selection can move under it.
      const command = { type: 'insertTable' as const, rows, cols };
      if (editor.can(command).ok) editor.exec(command);
      setOpenMenu(null);
    },
    [editor, isEnabled, setOpenMenu]
  );

  /**
   * Move the cursor within the grid and follow it with focus.
   *
   * Takes a STEP from the current cell rather than an absolute target, applied through the
   * functional updater: two key presses in one React batch would both read the same
   * captured `cursor` and the second would go nowhere, so a fast Right-Right lands one
   * cell over instead of two.
   */
  const move = useCallback((step: { rows?: number; cols?: number; toCol?: number }) => {
    setCursor((current) => {
      const next = {
        rows: Math.min(TABLE_GRID_ROWS, Math.max(1, current.rows + (step.rows ?? 0))),
        cols: Math.min(
          TABLE_GRID_COLUMNS,
          Math.max(1, step.toCol ?? current.cols + (step.cols ?? 0))
        ),
      };
      setHover(next);
      // Focus follows in a microtask so the cell it targets has been committed with its
      // new tabIndex.
      queueMicrotask(() =>
        gridRef.current
          ?.querySelector<HTMLElement>(`[data-cell="${next.rows}x${next.cols}"]`)
          ?.focus()
      );
      return next;
    });
  }, []);

  const cellRows: ReactNode[] = [];
  for (let row = 1; row <= TABLE_GRID_ROWS; row += 1) {
    const cells: ReactNode[] = [];
    for (let col = 1; col <= TABLE_GRID_COLUMNS; col += 1) {
      const filled = !!hover && row <= hover.rows && col <= hover.cols;
      cells.push(
        <button
          key={col}
          type="button"
          role="gridcell"
          data-cell={`${row}x${col}`}
          className="docx-menubar__grid-cell"
          // Roving tabindex across the whole grid.
          tabIndex={cursor.rows === row && cursor.cols === col ? 0 : -1}
          {...(filled ? { 'data-filled': '' } : {})}
          aria-label={`${col} × ${row}`}
          onMouseDown={guardToolbarMousedown}
          onMouseEnter={() => setHover({ rows: row, cols: col })}
          onFocus={() => setHover({ rows: row, cols: col })}
          onClick={() => insert(row, col)}
        />
      );
    }
    cellRows.push(
      <div key={row} role="row" className="docx-menubar__grid-row">
        {cells}
      </div>
    );
  }

  return (
    <div
      ref={gridRef}
      // A 2-D size picker is a GRID, not a list of menu items: `menuitem` on 36 cells
      // announces them without any positional context, and the roles a menu permits do not
      // include one for "cell in a 6x6".
      role="grid"
      aria-label={`${TABLE_GRID_COLUMNS} × ${TABLE_GRID_ROWS}`}
      className={`docx-menubar__grid${className ? ` ${className}` : ''}`}
      onMouseLeave={() => setHover(null)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') move({ cols: 1 });
        else if (event.key === 'ArrowLeft') move({ cols: -1 });
        else if (event.key === 'ArrowDown') move({ rows: 1 });
        else if (event.key === 'ArrowUp') move({ rows: -1 });
        else if (event.key === 'Home') move({ toCol: 1 });
        else if (event.key === 'End') move({ toCol: TABLE_GRID_COLUMNS });
        else return;
        // Stopped so the grid's arrows do not ALSO walk the menu rows behind it.
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="docx-menubar__grid-cells">{cellRows}</div>
      {/* Not a live region: `role="status"` here announced on every one of the 36 cells a
          pointer sweep crosses. The size is already on each cell's accessible name, which
          is what a screen-reader user actually hears as they move. */}
      <div className="docx-menubar__grid-caption" aria-hidden="true">
        {hover ? `${hover.cols} × ${hover.rows}` : ''}
      </div>
    </div>
  );
}

/**
 * The Insert › Table row: the grid behind a disclosure when the engine can insert one, a
 * plain disabled row when it cannot.
 *
 * Disclosure is not a command, so a submenu parent is normally interactive whatever its
 * children can do — but that reasoning only holds when SOMETHING in the panel can act.
 * With every cell refused the caret invites a click that opens a dead grid, and the
 * engine's refusal ends up as body text in the panel, where a developer-facing string
 * ("not wired to an editor command") reads as product copy. Both go where every other
 * refused row puts them: a greyed row whose tooltip carries the engine's words.
 */
function MenuTablePicker({ entry }: { entry: ChromeMenuItemEntry }) {
  const { isEnabled } = useEditorCommand(entry.slot);
  const control = chromeControlForSlot(entry.slot);
  if (!isEnabled) {
    return <MenuItem slot={entry.slot} {...(entry.labelKey ? { labelKey: entry.labelKey } : {})} />;
  }
  return (
    <MenuSubmenu
      labelKey={entry.labelKey ?? control?.labelKey ?? entry.slot}
      paths={control?.paths}
    >
      <MenuTableGrid slot={entry.slot} />
    </MenuSubmenu>
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
  if (entry.slot === 'image.insert') return <MenuImageInsert />;
  if (entry.picker === 'tableGrid') return <MenuTablePicker entry={entry} />;
  return (
    <MenuItem
      slot={entry.slot}
      {...(entry.labelKey ? { labelKey: entry.labelKey } : {})}
      {...(entry.shortcutKey ? { shortcutKey: entry.shortcutKey } : {})}
    />
  );
}

/**
 * The ROW a child element replaces, or null for a child that is not a row part.
 *
 * Two shapes, matching how the toolbar recognizes its own parts: a pinned part carries a
 * fixed `docxSlot` static (`Menu.Open`, `Menu.Save`, `Menu.PageSetup`, `Menu.ReportIssue`),
 * and the generic `Menu.Item` carries a `docxMenuRow` marker plus its `slot` PROP. A
 * single-child Fragment unwraps, because `Children.toArray` does not flatten Fragment
 * elements and a host mapping over its overrides will wrap them.
 */
function rowKeyOfChild(child: ReactNode): string | null {
  if (!isValidElement(child)) return null;
  const unwrapped = unwrapFragment(child, rowKeyOfChild);
  if (unwrapped !== null) return unwrapped;
  const type = child.type as { docxSlot?: unknown; docxMenuRow?: unknown };
  if (typeof type !== 'function' && typeof type !== 'object') return null;
  if (typeof type.docxSlot === 'string') return type.docxSlot;
  if (type.docxMenuRow === true) {
    const slot = (child.props as { slot?: unknown }).slot;
    if (typeof slot === 'string') return slot;
  }
  return null;
}

/** The row key of one registry entry. Separators and submenus are positional, not keyed. */
function rowKeyOfEntry(entry: ChromeMenuEntry, index: number): string {
  if (entry.kind === 'item') return entry.slot;
  if (entry.kind === 'submenu') return `submenu:${entry.labelKey}`;
  return `separator:${index}`;
}

/**
 * A panel's rows: the registry's arrangement with the host's row children merged IN PLACE.
 *
 * The same contract the toolbar root has, one level down, and for the same reason. Without
 * it, changing ONE row of the Insert menu meant re-listing every row — so a host that
 * wanted a different Image handler inherited responsibility for the break submenu, the
 * table picker and the table-of-contents row forever, and silently stopped tracking the
 * registry the day a row was added.
 *
 * `preset={false}` still renders children verbatim: when the ORDER is the point, stating it
 * is clearer than merging into it.
 */
function mergePanel(
  entries: readonly ChromeMenuEntry[] | undefined,
  children: ReactNode,
  preset: boolean
): ReactNode {
  return mergeArrangement({
    entries: entries ?? [],
    children,
    preset,
    keyOfEntry: rowKeyOfEntry,
    keyOfChild: rowKeyOfChild,
    renderEntry: (entry) => <MenuEntry entry={entry} />,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// One menu: trigger + panel
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Menu` and the four pinned menu parts. @public */
export interface MenuProps {
  /** Which menu this is. Only one panel in the bar is open at a time, keyed on this. */
  id: MenuId;
  /** i18n key of the trigger label. Defaults to the registry's. */
  labelKey?: string;
  /**
   * Literal trigger label, already resolved. Wins over `labelKey`, and is what a
   * host-defined menu uses — its name is not in our catalogue and never will be.
   */
  label?: string;
  /**
   * Icon shown before the trigger's label.
   *
   * OPT-IN and unset by default, because neither Word nor Docs puts icons on a menu bar and
   * the packaged bar should look like the thing it is imitating. It exists because every
   * other control in this library takes one — toolbar parts, menu rows — and a product with
   * its own visual language should not have to rebuild the trigger to add a glyph to it.
   *
   * Decorative: the label is the accessible name, so the icon is hidden from assistive tech.
   */
  icon?: ReactNode;
  className?: string;
  /** Render nothing — inside the default bar this removes the menu. */
  hidden?: boolean;
  /**
   * `false` renders `children` verbatim as the whole panel. Default `true`: the panel is
   * the registry's rows for this menu, with a row child REPLACING the row it names in
   * place (`hidden` removes it) and any other child appended. Use `false` when the order
   * matters and you want to state it yourself.
   */
  preset?: boolean;
  /** Panel content. */
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
export function Menu({
  id,
  labelKey,
  label: literal,
  icon,
  className,
  hidden,
  preset = true,
  children,
}: MenuProps) {
  const { openMenu, setOpenMenu, activeMenu } = useMenuContext();
  const label = useMenuLabel();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // Whether the panel was opened BY KEYBOARD, so focus should move into it. A pointer
  // user's focus must stay put — yanking it into the panel on hover would scroll the page
  // and fight the mouse.
  const openedByKey = useRef(false);
  // Set when HOVER switched the bar to this menu. The click that follows a hover-switch
  // must not toggle: the pointer moved onto a closed trigger, hover opened it, and by the
  // time `onClick` runs the state says "already open" — so a plain toggle would close the
  // menu the user just clicked on, which reads as the bar closing on them. Consumed by
  // the next click; a click on the ALREADY-open menu still closes it.
  const switchedByHover = useRef(false);
  const registry = CHROME_MENUS.find((menu) => menu.id === id);
  const open = openMenu === id;
  if (hidden) return null;
  const text = literal ?? label(labelKey ?? registry?.labelKey ?? id);
  const rows = mergePanel(registry?.entries, children, preset);
  // Closing returns focus to the trigger. Every close path UNMOUNTS the panel, so without
  // this the element holding focus disappears and focus falls to <body> — the user is
  // dumped at the top of the page with no announcement and has to tab back through the
  // whole header.
  const closeToTrigger = () => {
    setOpenMenu(null);
    triggerRef.current?.focus();
  };

  return (
    // `role="none"` on the wrapper: `menubar` must OWN its `menuitem`s, and an unrole'd
    // div between them breaks the relationship AT derives item counts and "x of y" from.
    <div
      role="none"
      className={`docx-menubar__menu-root${className ? ` ${className}` : ''}`}
      data-menu={id}
    >
      <button
        ref={triggerRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className="docx-menubar__trigger"
        // Roving tabindex: the bar is ONE tab stop, and arrows move within it. Without
        // this every trigger is a stop and a keyboard user tabs through four of them to
        // get past the editor's chrome.
        tabIndex={activeMenu === id ? 0 : -1}
        {...(open ? { 'data-open': '' } : {})}
        onMouseDown={guardToolbarMousedown}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openedByKey.current = true;
            setOpenMenu(id);
          } else if (event.key === 'ArrowUp') {
            // Word and Docs both open UPWARDS-from-the-bottom on ArrowUp.
            event.preventDefault();
            openedByKey.current = true;
            setOpenMenu(id);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            closeToTrigger();
          }
        }}
        onClick={() => {
          if (switchedByHover.current) {
            switchedByHover.current = false;
            return;
          }
          setOpenMenu(open ? null : id);
        }}
        // Docs' bar behaviour: once a menu is open the bar tracks the pointer, so
        // sliding across the triggers browses the menus without further clicks.
        onMouseEnter={() => {
          if (openMenu !== null && openMenu !== id) {
            switchedByHover.current = true;
            setOpenMenu(id);
          }
        }}
        onMouseLeave={() => {
          switchedByHover.current = false;
        }}
      >
        {icon ? (
          <span className="docx-menubar__trigger-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
        {text}
      </button>
      {open ? (
        <div
          ref={(node) => {
            panelRef.current = node;
            // Focus the first row when the panel was opened from the keyboard. Done in the
            // ref callback rather than an effect so it lands in the same commit the panel
            // mounts in, with no intermediate frame where focus is nowhere.
            if (node && openedByKey.current) {
              openedByKey.current = false;
              focusEdge(panelItems(node), 'first');
            }
          }}
          id={panelId}
          role="menu"
          aria-label={text}
          className="docx-toolbar__menu docx-menubar__menu"
          onKeyDown={(event) => {
            const panel = panelRef.current;
            if (!panel) return;
            const items = panelItems(panel);
            const focused = document.activeElement;
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              focusBy(items, focused, 1);
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              focusBy(items, focused, -1);
            } else if (event.key === 'Home') {
              event.preventDefault();
              focusEdge(items, 'first');
            } else if (event.key === 'End') {
              event.preventDefault();
              focusEdge(items, 'last');
            } else if (event.key === 'Escape') {
              // Stopped here so the root's document listener does not ALSO close the bar
              // and race the focus restore below.
              event.preventDefault();
              event.stopPropagation();
              closeToTrigger();
            } else if (event.key === 'Tab') {
              // Tab leaves the whole widget rather than walking every row: one tab stop.
              setOpenMenu(null);
            }
          }}
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

/** Props for `DocxEditor.Menu.ReportIssue`. @public */
export interface MenuReportIssueProps {
  className?: string;
  /** Render nothing — inside the packaged Help menu this removes the row. */
  hidden?: boolean;
  /** Replaces the packaged handler. Falls back to the menu's `onReportIssue`, then to
   *  this project's own tracker. */
  onSelect?: () => void;
}

/**
 * Help › Report issue.
 *
 * A NAMED part rather than anonymous markup inside the Help menu, because it is the one
 * packaged row that reaches OUTSIDE the host's product: it opens this project's issue
 * tracker with the current page URL and user agent prefilled. A host embedding the editor
 * in its own app has every reason to point that somewhere else or drop it, and it should
 * not have to rebuild the menu to do either — `reportIssue={false}` removes it,
 * `onReportIssue` redirects it, and this part composes it back by name.
 *
 * @public
 */
function MenuReportIssueImpl({ className, hidden, onSelect }: MenuReportIssueProps) {
  const { setOpenMenu, onReportIssue, reportIssue } = useMenuContext();
  const label = useMenuLabel();
  if (hidden || reportIssue === false) return null;
  const run = onSelect ?? onReportIssue ?? openReportIssue;
  return (
    <MenuRow
      slot="help.reportIssue"
      onSelect={() => {
        run();
        setOpenMenu(null);
      }}
      {...(className ? { className } : {})}
    >
      {label('toolbar.reportIssue')}
    </MenuRow>
  );
}

/**
 * The report-issue row, with its row-identity marker.
 *
 * The key is NOT a `ChromeSlotId` — the row is React's, not the shared registry's — but the
 * merge only needs a stable string, and using one here is what lets a host write
 * `<Menu.ReportIssue hidden/>` and have it REPLACE the packaged row rather than render a
 * second, invisible one beside it.
 *
 * @public
 */
export const MenuReportIssue = Object.assign(MenuReportIssueImpl, {
  docxSlot: 'help.reportIssue',
});

/**
 * Help.
 *
 * The registry leaves this menu EMPTY on purpose — a product's documentation and support
 * channel are the host's, not the library's. The one row the library can honestly own is
 * a report for this project's own tracker, so the packaged Help menu supplies it here
 * rather than in the shared registry, where a Vue or vanilla host would inherit a link it
 * never asked for. Replace the whole menu by name to say something else.
 *
 * With no children and `reportIssue` unset the menu carries that one row; with
 * `reportIssue={false}` it carries nothing, and Help is dropped rather than left as a
 * trigger that opens an empty panel.
 */
function MenuHelpImpl({ children, ...rest }: Omit<MenuProps, 'id'>) {
  const { reportIssue } = useMenuContext();
  if (children === undefined && reportIssue === false) return null;
  // The packaged row is passed as a CHILD rather than as a fallback, so the ordinary merge
  // rules reach it: a host adds rows beside it, and `<Menu.ReportIssue hidden/>` removes
  // just that row without taking the menu with it.
  return (
    <Menu id="help" {...rest}>
      <MenuReportIssue />
      {children}
    </Menu>
  );
}

export const MenuHelp: MenuPartComponent = Object.assign(MenuHelpImpl, {
  docxMenu: 'help' as ChromeMenuId,
});
