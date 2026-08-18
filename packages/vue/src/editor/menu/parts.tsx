import { computed, defineComponent, h, isVNode, ref, type PropType, type VNode } from 'vue';
import { flattenChildren } from '../../lib/flattenChildren';
import { docxSlotOf, mergeArrangement, unwrapFragment } from '../merge-arrangement';
import {
  CHROME_MENUS,
  chromeProbeForSlot,
  commandForSlot,
  type ChromeMenuEntry,
  type ChromeMenuId,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { openReportIssue } from '../../lib/reportIssue';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel, type MenuId } from './menu-context';
import { focusBy, focusEdge, panelItems } from './menu-keyboard';
import { useImageInsert } from '../images/ImageInsert';
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

/** Vue reserves `slot`; spread onto MenuRow as data-slot. */
export function menuRowSlot(id: string): { 'data-slot': string } {
  return { 'data-slot': id };
}

// ─────────────────────────────────────────────────────────────────────────────
// The generic row
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Row`: one presentational menu row. @public */
export interface MenuRowProps {
  /** Material Symbols paths, rendered as inline SVG in the row's icon column. */
  icon?: VNode;
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
  /** Stable marker for hosts, tests and e2e — pass via {@link menuRowSlot}. */
  'data-slot'?: string;
  /** React parity — maps to `data-slot` at runtime. */
  slot?: string;
  onSelect?: () => void;
  className?: string;
  children?: VNode;
}

/**
 * One menu row: icon column, label, shortcut column.
 *
 * The icon column is reserved even when a row has no icon, so labels line up down the
 * panel the way Word's and Docs' menus do.
 *
 * @public
 */
export const MenuRow = defineComponent({
  name: 'MenuRow',
  props: {
    icon: { type: null as unknown as PropType<VNode>, default: undefined },
    shortcut: { type: String, default: undefined },
    disabled: { type: Boolean, default: undefined },
    title: { type: String, default: undefined },
    active: { type: Boolean, default: undefined },
    selected: { type: Boolean, default: undefined },
    'data-slot': { type: String, default: undefined },
    onSelect: { type: Function as PropType<() => void>, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const { icon, shortcut, disabled, title, active, selected, onSelect, className } = props;
    const dataSlot = (props as MenuRowProps)['data-slot'];
    const reasonId = `docx-${Math.random().toString(36).slice(2, 9)}`;
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
    return () => (
      <button
        type="button"
        role={role}
        class={`docx-toolbar__menu-item docx-menubar__item${className ? ` ${className}` : ''}`}
        // Every row is reachable by the menu's own arrow keys, never by Tab: one tab stop
        // per menu, which is the menu pattern (and what keeps a 36-cell grid from being 36
        // tab stops).
        tabindex={-1}
        {...(dataSlot ? { 'data-slot': dataSlot } : {})}
        {...(active ? { 'data-active': '' } : {})}
        {...(disabled ? { 'data-disabled': '', 'aria-disabled': true } : {})}
        {...(active !== undefined ? { 'aria-checked': active } : {})}
        {...(describe ? { 'aria-describedby': describe } : {})}
        {...(title ? { title } : {})}
        onMousedown={guardToolbarMousedown}
        onClick={disabled ? undefined : onSelect}
      >
        <span class="docx-menubar__item-icon" aria-hidden="true">
          {icon}
        </span>
        <span class="docx-menubar__item-label">{slots.default?.()}</span>
        {shortcut ? <span class="docx-menubar__item-shortcut">{shortcut}</span> : null}
        {describe ? (
          <span id={reasonId} class="docx-editor-sr-only">
            {title}
          </span>
        ) : null}
      </button>
    );
  },
});

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
  children?: VNode;
}

/**
 * A named section inside a panel: a visible heading and the rows under it.
 *
 * A separator says rows are apart; a group says what they are, which is what a panel needs
 * once a product adds rows beside the packaged ones. `role="group"` nests legally inside a
 * menu, keeps its rows owned by it, and takes the heading as its accessible name — so the
 * visible heading is decoration and is hidden from the tree.
 *
 * @public
 */
export const MenuGroup = defineComponent({
  name: 'MenuGroup',
  props: {
    labelKey: { type: String, default: undefined },
    literal: { type: String, default: undefined },
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props, { slots }) {
    const label = useMenuLabel();
    return () => {
      if (props.hidden) return null;
      const text =
        props.literal ?? (props.labelKey === undefined ? undefined : label(props.labelKey));
      return (
        <div
          role="group"
          class={`docx-menubar__group${props.className ? ` ${props.className}` : ''}`}
          {...(text ? { 'aria-label': text } : {})}
        >
          {text ? (
            <div class="docx-menubar__group-label" aria-hidden="true">
              {text}
            </div>
          ) : null}
          {slots.default?.()}
        </div>
      );
    };
  },
});

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
export const MenuItem = defineComponent({
  name: 'MenuItem',
  props: {
    slot: { type: String as PropType<ChromeSlotId>, required: true },
    labelKey: { type: String, default: undefined },
    shortcutKey: { type: String, default: undefined },
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const slotId = computed(() => props.slot as ChromeSlotId);
    const slotCmd = useEditorCommand(slotId);
    const { setOpenMenu } = useMenuContext();
    const label = useMenuLabel();
    return () => {
      if (props.hidden) return null;
      const slot = slotId.value;
      const control = chromeControlForSlot(slot);
      const text = label(props.labelKey ?? control?.labelKey ?? slot);
      const command = commandForSlot(slot);
      const isToggle = command?.type === 'toggleMark' || command?.type === 'setAlignment';
      const isRadio = command?.type === 'setAlignment';
      return (
        <MenuRow
          {...menuRowSlot(slot)}
          icon={chromeIcon(control?.paths) ?? undefined}
          {...(props.shortcutKey ? { shortcut: label(props.shortcutKey) } : {})}
          disabled={!slotCmd.isEnabled.value}
          {...(slotCmd.disabledReason.value ? { title: slotCmd.disabledReason.value } : {})}
          {...(isToggle ? { active: slotCmd.isActive.value } : {})}
          {...(isRadio ? { selected: true as const } : {})}
          onSelect={() => {
            slotCmd.execute();
            setOpenMenu(null);
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {text}
        </MenuRow>
      );
    };
  },
});

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
  const Part = defineComponent({
    name: `MenuAction_${slot}`,
    props: {
      className: { type: String, default: undefined },
      hidden: { type: Boolean, default: undefined },
    },
    setup(props) {
      const context = useMenuContext();
      const label = useMenuLabel();
      return () => {
        const handler = pick(context);
        if (props.hidden) return null;
        const control = chromeControlForSlot(slot);
        const text = label(labelKey ?? control?.labelKey ?? slot);
        return (
          <MenuRow
            {...menuRowSlot(slot)}
            icon={chromeIcon(control?.paths) ?? undefined}
            {...(shortcutKey ? { shortcut: label(shortcutKey) } : {})}
            disabled={!handler}
            onSelect={() => {
              handler?.();
              context.setOpenMenu(null);
            }}
            {...(props.className ? { className: props.className } : {})}
          >
            {text}
          </MenuRow>
        );
      };
    },
  });
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
const MenuPageSetupImpl = defineComponent({
  name: 'MenuPageSetupImpl',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const context = useMenuContext();
    const label = useMenuLabel();
    return () => {
      if (props.hidden) return null;
      const probe = chromeProbeForSlot('file.pageSetup');
      const allowed = editorRef.value && probe ? editorRef.value.can(probe) : null;
      const engineOk = allowed?.ok === true;
      const engineReason = allowed && !allowed.ok ? allowed.reason : null;
      const control = chromeControlForSlot('file.pageSetup');
      const text = label(control?.labelKey ?? 'file.pageSetup');
      const enabled = engineOk && !!context.onPageSetup;
      return (
        <MenuRow
          {...menuRowSlot('file.pageSetup')}
          icon={chromeIcon(control?.paths) ?? undefined}
          disabled={!enabled}
          {...(engineReason ? { title: engineReason } : {})}
          onSelect={() => {
            context.onPageSetup?.();
            context.setOpenMenu(null);
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {text}
        </MenuRow>
      );
    };
  },
});

export const MenuPageSetup = Object.assign(MenuPageSetupImpl, {
  docxSlot: 'file.pageSetup' as ChromeSlotId,
});

const MenuImageInsertImpl = defineComponent({
  name: 'MenuImageInsertImpl',
  props: {
    className: { type: null as unknown as PropType<unknown>, default: undefined },
    hidden: { type: null as unknown as PropType<unknown>, default: undefined },
  },
  setup(props) {
    const { openFilePicker, isEnabled, disabledReason } = useImageInsert();
    const context = useMenuContext();
    const label = useMenuLabel();
    return () => {
      if (props.hidden) return null;
      const control = chromeControlForSlot('image.insert');
      const text = label(control?.labelKey ?? 'toolbar.image');
      return (
        <MenuRow
          {...menuRowSlot('image.insert')}
          icon={chromeIcon(control?.paths) ?? undefined}
          disabled={!isEnabled}
          {...(disabledReason ? { title: disabledReason } : {})}
          onSelect={() => {
            openFilePicker();
            context.setOpenMenu(null);
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {text}
        </MenuRow>
      );
    };
  },
});

export const MenuImageInsert = Object.assign(MenuImageInsertImpl, {
  docxSlot: 'image.insert' as ChromeSlotId,
});

import { MenuSubmenu, MenuTablePicker } from './menu-flyouts';
export { MenuSubmenu, MenuTableGrid } from './menu-flyouts';
export type { MenuSubmenuProps, MenuTableGridProps } from './menu-flyouts';

// ─────────────────────────────────────────────────────────────────────────────
// Separator, and the registry-driven entry renderer
// ─────────────────────────────────────────────────────────────────────────────

/** Props for `DocxEditor.Menu.Separator`. @public */
export interface MenuSeparatorProps {
  className?: string;
}

/** A horizontal rule between groups of rows. @public */
export const MenuSeparator = defineComponent({
  name: 'MenuSeparator',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props) {
    return () => (
      <div
        role="separator"
        class={`docx-toolbar__menu-separator${props.className ? ` ${props.className}` : ''}`}
      />
    );
  },
});

/**
 * One registry entry as its row.
 *
 * The three host-boundary slots route to their pinned parts rather than to the generic
 * `MenuItem`, because a command-driven row would render them permanently disabled — the
 * engine reports, correctly, that neither open nor save is a command.
 */
export const MenuEntry = defineComponent({
  name: 'MenuEntry',
  props: {
    entry: { type: Object as PropType<ChromeMenuEntry>, required: true },
  },
  setup(props) {
    return () => {
      const entry = props.entry;
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
          {...({ slot: entry.slot } as { slot: ChromeSlotId })}
          {...(entry.labelKey ? { labelKey: entry.labelKey } : {})}
          {...(entry.shortcutKey ? { shortcutKey: entry.shortcutKey } : {})}
        />
      );
    };
  },
});

function rowKeyOfChild(child: VNode): string | null {
  if (!isVNode(child)) return null;
  const unwrapped = unwrapFragment(child, rowKeyOfChild);
  if (unwrapped !== null) return unwrapped;
  const slot = docxSlotOf(child);
  if (slot) return slot;
  const type = child.type as { docxMenuRow?: unknown };
  if (typeof type === 'object' && type !== null && type.docxMenuRow === true) {
    const slotProp = child.props?.slot;
    if (typeof slotProp === 'string') return slotProp;
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
  children: VNode[],
  preset: boolean
): VNode[] {
  return mergeArrangement({
    entries: entries ?? [],
    children,
    preset,
    keyOfEntry: rowKeyOfEntry,
    keyOfChild: rowKeyOfChild,
    renderEntry: (entry) => <MenuEntry entry={entry} />,
  }) as VNode[];
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
  icon?: VNode;
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
  children?: VNode;
}

/**
 * One menu of the bar: a trigger and the panel it opens.
 *
 * Bar behaviour is Docs': a click opens, a second click closes, and while ANY menu is
 * open, moving the pointer over a different trigger switches to it without a click.
 *
 * @public
 */
export const Menu = defineComponent({
  name: 'Menu',
  props: {
    id: { type: String, required: true },
    labelKey: { type: String, default: undefined },
    label: { type: String, default: undefined },
    icon: { type: null as unknown as PropType<VNode>, default: undefined },
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    preset: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const { openMenu, setOpenMenu, activeMenu } = useMenuContext();
    const label = useMenuLabel();
    const panelId = `docx-${Math.random().toString(36).slice(2, 9)}`;
    const triggerRef = ref<HTMLButtonElement | null>(null);
    const panelRef = ref<HTMLDivElement | null>(null);
    const openedByKey = ref(false);
    const switchedByHover = ref(false);

    const closeToTrigger = () => {
      setOpenMenu(null);
      triggerRef.value?.focus();
    };

    return () => {
      if (props.hidden) return null;
      const registry = CHROME_MENUS.find((menu) => menu.id === props.id);
      const open = openMenu === props.id;
      const text = props.label ?? label(props.labelKey ?? registry?.labelKey ?? props.id);
      const rows = mergePanel(
        registry?.entries,
        flattenChildren(slots.default?.() ?? []),
        props.preset
      );

      return (
        <div
          role="none"
          class={`docx-menubar__menu-root${props.className ? ` ${props.className}` : ''}`}
          data-menu={props.id}
        >
          <button
            ref={triggerRef}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            class="docx-menubar__trigger"
            tabindex={activeMenu === props.id ? 0 : -1}
            {...(open ? { 'data-open': '' } : {})}
            onMousedown={guardToolbarMousedown}
            onKeydown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openedByKey.value = true;
                setOpenMenu(props.id);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                openedByKey.value = true;
                setOpenMenu(props.id);
              } else if (event.key === 'Escape' && open) {
                event.preventDefault();
                closeToTrigger();
              }
            }}
            onClick={() => {
              if (switchedByHover.value) {
                switchedByHover.value = false;
                return;
              }
              setOpenMenu(open ? null : props.id);
            }}
            onMouseenter={() => {
              if (openMenu !== null && openMenu !== props.id) {
                switchedByHover.value = true;
                setOpenMenu(props.id);
              }
            }}
            onMouseleave={() => {
              switchedByHover.value = false;
            }}
          >
            {props.icon ? (
              <span class="docx-menubar__trigger-icon" aria-hidden="true">
                {props.icon}
              </span>
            ) : null}
            {text}
          </button>
          {open ? (
            <div
              ref={(node) => {
                panelRef.value = node as HTMLDivElement | null;
                if (node && openedByKey.value) {
                  openedByKey.value = false;
                  focusEdge(panelItems(node as HTMLDivElement), 'first');
                }
              }}
              id={panelId}
              role="menu"
              aria-label={text}
              class="docx-toolbar__menu docx-menubar__menu"
              onKeydown={(event) => {
                const panel = panelRef.value;
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
                  event.preventDefault();
                  event.stopPropagation();
                  closeToTrigger();
                } else if (event.key === 'Tab') {
                  setOpenMenu(null);
                }
              }}
            >
              {rows}
            </div>
          ) : null}
        </div>
      );
    };
  },
});

/** A menu pinned to one registry id, for `DocxEditor.Menu.File` and friends. @public */
export interface MenuPartComponent {
  (props: Omit<MenuProps, 'id'>): VNode;
  readonly docxMenu: ChromeMenuId;
}

function defineMenu(id: ChromeMenuId): MenuPartComponent {
  const Part = defineComponent({
    name: `Menu_${id}`,
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () =>
        h(Menu, { id, ...attrs }, slots.default ? { default: slots.default } : undefined);
    },
  });
  return Object.assign(Part, { docxMenu: id }) as unknown as MenuPartComponent;
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
 * tracker with the current page URL and user agent prefilled. A host embedding the editorRef.value
 * in its own app has every reason to point that somewhere else or drop it, and it should
 * not have to rebuild the menu to do either — `reportIssue={false}` removes it,
 * `onReportIssue` redirects it, and this part composes it back by name.
 *
 * @public
 */
const MenuReportIssueImpl = defineComponent({
  name: 'MenuReportIssueImpl',
  props: {
    className: { type: String, default: undefined },
    hidden: { type: Boolean, default: undefined },
    onSelect: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props) {
    const { setOpenMenu, onReportIssue, reportIssue } = useMenuContext();
    const label = useMenuLabel();
    return () => {
      if (props.hidden || reportIssue === false) return null;
      const run = props.onSelect ?? onReportIssue ?? openReportIssue;
      return (
        <MenuRow
          {...menuRowSlot('help.reportIssue')}
          onSelect={() => {
            run();
            setOpenMenu(null);
          }}
          {...(props.className ? { className: props.className } : {})}
        >
          {label('toolbar.reportIssue')}
        </MenuRow>
      );
    };
  },
});

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
const MenuHelpImpl = defineComponent({
  name: 'MenuHelpImpl',
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    const { reportIssue } = useMenuContext();
    return () => {
      if (slots.default === undefined && reportIssue === false) return null;
      return (
        <Menu id="help" {...attrs}>
          <MenuReportIssue />
          {slots.default?.()}
        </Menu>
      );
    };
  },
});

export const MenuHelp = Object.assign(MenuHelpImpl, {
  docxMenu: 'help' as ChromeMenuId,
}) as unknown as MenuPartComponent;
