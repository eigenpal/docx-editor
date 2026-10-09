import { warnMissingSubmenuLabel } from './menu-warnings';
import { defineComponent, ref, watch, type PropType } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { type ChromeMenuItemEntry, type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { useStableDocxId } from '../../lib/stable-id';
import { formatPx } from '../../lib/units';
import { focusBy, focusEdge, panelItems } from './menu-keyboard';
import { MenuItem } from './parts';
import { TableSizeGrid } from '../toolbar/TableSizeGrid';

/** How close a floating panel may come to the window edge, in px. */
const EDGE_INSET = 8;

/**
 * Props for `DocxEditor.Menu.Submenu`. Set `labelKey` or `label`. A submenu with neither has
 * no name, with a development warning. An interface, so a host can extend it.
 *
 * @public
 */
export interface MenuSubmenuProps extends MenuSubmenuBaseProps {
  /** i18n key of the parent row's label. */
  labelKey?: string;
  /** Literal parent row label, already resolved. Wins over `labelKey`. */
  label?: string;
}

/** The props every `Menu.Submenu` takes besides its label. @public */
export interface MenuSubmenuBaseProps {
  /** Material Symbols paths for the parent row's icon. */
  paths?: readonly string[] | null;
  className?: string;
  children?: DocxEditorChildren;
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
export const MenuSubmenu = defineComponent({
  name: 'MenuSubmenu',
  props: {
    labelKey: { type: String, default: undefined },
    label: { type: String, default: undefined },
    paths: { type: null as unknown as PropType<readonly string[] | null>, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const label = useMenuLabel();
    const open = ref(false);
    const parentRef = ref<HTMLButtonElement | null>(null);
    const panelRef = ref<HTMLDivElement | null>(null);
    const panelId = useStableDocxId('menu-flyout');
    const box = ref<{ left: number; top: number } | null>(null);

    watch(
      open,
      (isOpen) => {
        if (!isOpen) {
          box.value = null;
          return;
        }
        const row = parentRef.value;
        const panel = panelRef.value;
        const view = row?.ownerDocument.defaultView;
        if (!row || !panel || !view) return;
        const rect = row.getBoundingClientRect();
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const flip = rect.right + width > view.innerWidth - EDGE_INSET;
        box.value = {
          left: flip
            ? Math.max(EDGE_INSET, rect.left - width)
            : Math.min(rect.right, view.innerWidth - width - EDGE_INSET),
          top: Math.max(EDGE_INSET, Math.min(rect.top - 4, view.innerHeight - height - EDGE_INSET)),
        };
      },
      { flush: 'post' }
    );

    return () => {
      if (props.label === undefined && props.labelKey === undefined) warnMissingSubmenuLabel();
      const text = props.label ?? label(props.labelKey ?? '');
      return (
        <div
          role="none"
          class={`docx-menubar__submenu${props.className ? ` ${props.className}` : ''}`}
          onMouseenter={() => {
            open.value = true;
          }}
          onMouseleave={() => {
            open.value = false;
          }}
          onKeydown={(event) => {
            if (event.key === 'ArrowRight' && document.activeElement === parentRef.value) {
              event.preventDefault();
              open.value = true;
              queueMicrotask(() => {
                if (panelRef.value) focusEdge(panelItems(panelRef.value), 'first');
              });
            } else if ((event.key === 'ArrowLeft' || event.key === 'Escape') && open.value) {
              event.preventDefault();
              event.stopPropagation();
              open.value = false;
              parentRef.value?.focus();
            }
          }}
          onBlur={(event) => {
            const current = event.currentTarget as HTMLElement | null;
            if (!current?.contains(event.relatedTarget as Node | null)) open.value = false;
          }}
        >
          <button
            ref={parentRef}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open.value}
            aria-controls={open.value ? panelId : undefined}
            class="docx-toolbar__menu-item docx-menubar__item"
            tabindex={-1}
            {...(open.value ? { 'data-open': '' } : {})}
            onMousedown={guardToolbarMousedown}
            onFocus={() => {
              open.value = true;
            }}
            onClick={() => {
              open.value = true;
            }}
          >
            <span class="docx-menubar__item-icon" aria-hidden="true">
              {chromeIcon(props.paths)}
            </span>
            <span class="docx-menubar__item-label">{text}</span>
            <span class="docx-menubar__item-caret" aria-hidden="true">
              ›
            </span>
          </button>
          {open.value ? (
            <div
              ref={panelRef}
              id={panelId}
              class="docx-toolbar__menu docx-menubar__menu docx-menubar__submenu-panel"
              role="menu"
              aria-label={text}
              style={
                box.value
                  ? {
                      position: 'fixed',
                      left: formatPx(box.value.left),
                      top: formatPx(box.value.top),
                    }
                  : { position: 'fixed', visibility: 'hidden' }
              }
              onKeydown={(event) => {
                const panel = panelRef.value;
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
              {slots.default?.()}
            </div>
          ) : null}
        </div>
      );
    };
  },
});

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
 * The insert-table size picker: a 6×6 grid that highlights as the pointer sweeps it and
 * reads back the size underneath. A pick inserts the table and closes the menu bar.
 *
 * Rendered only when the engine will honour an insert (see `MenuTablePicker`). A panel
 * that opens onto a grid nothing can be picked from is worse than no panel: the row
 * cannot act, so it should not disclose — it should look disabled, like every other row
 * the engine refuses.
 *
 * @public
 */
export const MenuTableGrid = defineComponent({
  name: 'MenuTableGrid',
  props: {
    slot: { type: String as PropType<ChromeSlotId>, default: undefined },
    className: { type: null as unknown as PropType<unknown>, default: undefined },
  },
  setup(props) {
    const menuContext = useMenuContext();
    const label = useMenuLabel();
    const close = () => menuContext.value.setOpenMenu(null);
    return () => (
      <TableSizeGrid
        slot={(props.slot as ChromeSlotId | undefined) ?? 'table.insert'}
        label={label('toolbar.insertTable')}
        onInserted={close}
        className={props.className}
      />
    );
  },
});

/**
 * The Insert › Table row: the grid behind a disclosure when the engine can insert one, a
 * plain disabled row when it cannot.
 *
 * Disclosure is not a command, so a submenu parent is normally interactive whatever its
 * children can do — but that reasoning only holds when SOMETHING in the panel can act.
 * With every cell refused the caret invites a click that opens a dead grid, and the
 * engine's refusal ends up as body text in the panel, where a developer-facing string
 * ("not wired to an editorRef.value command") reads as product copy. Both go where every other
 * refused row puts them: a greyed row whose tooltip carries the engine's words.
 */
export const MenuTablePicker = defineComponent({
  name: 'MenuTablePicker',
  props: {
    entry: { type: Object as PropType<ChromeMenuItemEntry>, required: true },
  },
  setup(props) {
    const pickerCmd = useEditorCommand(props.entry.slot);
    const control = chromeControlForSlot(props.entry.slot);
    return () => {
      if (!pickerCmd.isEnabled.value) {
        return (
          <MenuItem
            slotId={props.entry.slot}
            {...(props.entry.labelKey ? { labelKey: props.entry.labelKey } : {})}
          />
        );
      }
      return (
        <MenuSubmenu
          labelKey={props.entry.labelKey ?? control?.labelKey ?? props.entry.slot}
          paths={control?.paths}
        >
          <MenuTableGrid {...({ slot: props.entry.slot } as { slot: ChromeSlotId })} />
        </MenuSubmenu>
      );
    };
  },
});
