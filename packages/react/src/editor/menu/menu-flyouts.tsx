import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import type { ChromeSlotId } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from '../context';
import { useEditorCommand } from '../useEditorCommand';
import { guardToolbarMousedown } from '../toolbar/ToolbarButton';
import { useMenuContext, useMenuLabel } from './menu-context';

/** Word's insert-table grid is 6 columns by 6 rows. */
const TABLE_GRID_COLUMNS = 6;
const TABLE_GRID_ROWS = 6;

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
  const label = useMenuLabel();
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
      if (!editor.can(command).ok) return;
      editor.exec(command);
      setOpenMenu(null);
      // The engine left the caret in the first cell; DOM focus is still on the grid cell
      // that was clicked, and the panel is about to unmount. Without this the user has to
      // click into a table they just asked for before they can type in it.
      editor.focus();
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
      aria-label={label('toolbar.insertTable')}
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
