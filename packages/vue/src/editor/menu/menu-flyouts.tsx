import { computed, defineComponent, ref, watch, type PropType, type VNode } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { type ChromeMenuItemEntry, type ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';
import { focusBy, focusEdge, panelItems } from './menu-keyboard';
import { MenuItem } from './parts';

const TABLE_GRID_COLUMNS = 6;
const TABLE_GRID_ROWS = 6;
/** Props for `DocxEditor.Menu.Submenu`. @public */
/** How close a floating panel may come to the window edge, in px. */
const EDGE_INSET = 8;

export interface MenuSubmenuProps {
  /** i18n key of the parent row's label. */
  labelKey: string;
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
    labelKey: { type: String, required: true },
    paths: { type: null as unknown as PropType<readonly string[] | null>, default: undefined },
    className: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const label = useMenuLabel();
    const open = ref(false);
    const parentRef = ref<HTMLButtonElement | null>(null);
    const panelRef = ref<HTMLDivElement | null>(null);
    const panelId = `docx-${Math.random().toString(36).slice(2, 9)}`;
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
      const text = label(props.labelKey);
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
                  ? { position: 'fixed', left: box.value.left, top: box.value.top }
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
export const MenuTableGrid = defineComponent({
  name: 'MenuTableGrid',
  props: {
    slot: { type: String as PropType<ChromeSlotId>, default: undefined },
    className: { type: null as unknown as PropType<unknown>, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const gridCmd = useEditorCommand(
      computed(
        () => (props.slot as ChromeSlotId | undefined) ?? 'table.insert'
      ) as unknown as ChromeSlotId
    );
    const menuContext = useMenuContext();
    const hover = ref<{ rows: number; cols: number } | null>(null);
    const cursor = ref({ rows: 1, cols: 1 });
    const gridRef = ref<HTMLDivElement | null>(null);

    const insert = (rows: number, cols: number) => {
      if (!editorRef.value || !gridCmd.isEnabled.value) return;
      const command = { type: 'insertTable' as const, rows, cols };
      if (!editorRef.value.can(command).ok) return;
      editorRef.value.exec(command);
      menuContext.value.setOpenMenu(null);
      editorRef.value.focus();
    };

    const move = (step: { rows?: number; cols?: number; toCol?: number }) => {
      const current = cursor.value;
      const next = {
        rows: Math.min(TABLE_GRID_ROWS, Math.max(1, current.rows + (step.rows ?? 0))),
        cols: Math.min(
          TABLE_GRID_COLUMNS,
          Math.max(1, step.toCol ?? current.cols + (step.cols ?? 0))
        ),
      };
      cursor.value = next;
      hover.value = next;
      queueMicrotask(() =>
        gridRef.value
          ?.querySelector<HTMLElement>(`[data-cell="${next.rows}x${next.cols}"]`)
          ?.focus()
      );
    };

    return () => {
      const cellRows: VNode[] = [];
      for (let row = 1; row <= TABLE_GRID_ROWS; row += 1) {
        const cells: VNode[] = [];
        for (let col = 1; col <= TABLE_GRID_COLUMNS; col += 1) {
          const filled = !!hover.value && row <= hover.value.rows && col <= hover.value.cols;
          cells.push(
            <button
              key={col}
              type="button"
              role="gridcell"
              data-cell={`${row}x${col}`}
              class="docx-menubar__grid-cell"
              tabindex={cursor.value.rows === row && cursor.value.cols === col ? 0 : -1}
              {...(filled ? { 'data-filled': '' } : {})}
              aria-label={`${col} × ${row}`}
              onMousedown={guardToolbarMousedown}
              onMouseenter={() => {
                hover.value = { rows: row, cols: col };
              }}
              onFocus={() => {
                hover.value = { rows: row, cols: col };
              }}
              onClick={() => insert(row, col)}
            />
          );
        }
        cellRows.push(
          <div key={row} role="row" class="docx-menubar__grid-row">
            {cells}
          </div>
        );
      }

      return (
        <div
          ref={gridRef}
          role="grid"
          class={`docx-menubar__grid${props.className ? ` ${props.className}` : ''}`}
          aria-label="Insert table"
          onKeydown={(event: KeyboardEvent) => {
            if (event.key === 'ArrowRight') move({ cols: 1 });
            else if (event.key === 'ArrowLeft') move({ cols: -1 });
            else if (event.key === 'ArrowDown') move({ rows: 1 });
            else if (event.key === 'ArrowUp') move({ rows: -1 });
            else if (event.key === 'Home') move({ toCol: 1 });
            else if (event.key === 'End') move({ toCol: TABLE_GRID_COLUMNS });
            else if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              insert(cursor.value.rows, cursor.value.cols);
            } else return;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <div class="docx-menubar__grid-cells">{cellRows}</div>
          <div class="docx-menubar__grid-caption" aria-hidden="true">
            {hover.value ? `${hover.value.cols} × ${hover.value.rows}` : ''}
          </div>
        </div>
      );
    };
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
            {...({ slot: props.entry.slot } as { slot: ChromeSlotId })}
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
