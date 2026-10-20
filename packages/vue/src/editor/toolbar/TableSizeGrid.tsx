// The insert-table size grid, shared by the menu bar's Insert › Table row and the toolbar's
// table part. One grid, so the two places cannot disagree about size, keys, or naming.

import { computed, defineComponent, ref, type PropType, type VNode } from 'vue';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { guardToolbarMousedown } from './ToolbarButton';

/** The insert-table grid is 6 columns by 6 rows. */
export const TABLE_GRID_COLUMNS = 6;
export const TABLE_GRID_ROWS = 6;

/**
 * A 6×6 grid that highlights as the pointer sweeps it and inserts a table of the size under
 * it. One tab stop, with arrows, Home and End moving inside it.
 */
export const TableSizeGrid = defineComponent({
  name: 'TableSizeGrid',
  props: {
    /** The slot whose enabled state gates the insert. */
    slot: { type: String as PropType<ChromeSlotId>, required: true },
    /** Accessible name of the grid. */
    label: { type: String, required: true },
    /** Runs after a table is inserted, to close the surrounding popup. */
    onInserted: { type: Function as PropType<() => void>, required: true },
    className: { type: null as unknown as PropType<unknown>, default: undefined },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const gridCmd = useEditorCommand(computed(() => props.slot) as unknown as ChromeSlotId);
    const hover = ref<{ rows: number; cols: number } | null>(null);
    const cursor = ref({ rows: 1, cols: 1 });
    const gridRef = ref<HTMLDivElement | null>(null);

    const insert = (rows: number, cols: number) => {
      const editor = editorRef.value;
      if (!editor || !gridCmd.isEnabled.value) return;
      // can-before-exec even here: the popup opened because the slot was enabled, and the
      // selection can move under it.
      const command = { type: 'insertTable' as const, rows, cols };
      if (!editor.can(command).ok) return;
      editor.exec(command);
      props.onInserted();
      // The engine left the caret in the first cell; focus goes back to the document.
      editor.focus();
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
          // A 2-D size picker is a GRID, not a list of menu items.
          role="grid"
          class={`docx-menubar__grid${props.className ? ` ${props.className}` : ''}`}
          aria-label={props.label}
          onMouseleave={() => {
            hover.value = null;
          }}
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
            // Stopped so the grid's arrows do not ALSO walk the menu rows behind it.
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
