/**
 * Body-PM table helpers for dual-render e2e.
 */

import type { Page } from '@playwright/test';

/**
 * Count rows of the table that contains the current selection.
 * Returns -1 when there is no view or the caret is not inside a table.
 */
export async function countBodyPmTableRows(page: Page): Promise<number> {
  return page.evaluate(() => {
    const view = window.__DOCX_EDITOR_E2E__?.getView?.();
    if (!view) return -1;
    const $from = view.state.selection.$from;
    for (let d = $from.depth; d > 0; d--) {
      const node = $from.node(d);
      if (node.type.name === 'table') return node.childCount;
    }
    return -1;
  });
}

/** Place caret in a table cell via body-PM TextSelection.near. */
export async function focusBodyPmTableCell(
  page: Page,
  tableIndex: number,
  row: number,
  col: number
): Promise<boolean> {
  const ok = await page.evaluate(
    ({ tableIndex: tIdx, row: r, col: c }) => {
      const view = window.__DOCX_EDITOR_E2E__?.getView?.();
      if (!view) return false;
      let tableCount = -1;
      let target: number | null = null;
      view.state.doc.descendants(
        (
          node: {
            type: { name: string };
            childCount: number;
            child: (i: number) => {
              childCount: number;
              nodeSize: number;
              child: (j: number) => { nodeSize: number };
            };
          },
          pos: number
        ) => {
          if (target != null) return false;
          if (node.type.name !== 'table') return true;
          tableCount += 1;
          if (tableCount !== tIdx) return true;
          let rowPos = pos + 1;
          for (let ri = 0; ri < node.childCount; ri++) {
            const rowNode = node.child(ri);
            if (ri === r) {
              let cellPos = rowPos + 1;
              for (let ci = 0; ci < rowNode.childCount; ci++) {
                const cellNode = rowNode.child(ci);
                if (ci === c) {
                  target = cellPos + 1;
                  return false;
                }
                cellPos += cellNode.nodeSize;
              }
            }
            rowPos += rowNode.nodeSize;
          }
          return false;
        }
      );
      if (target == null) return false;
      const SelectionCtor = view.state.selection.constructor as {
        near: (pos: unknown) => unknown;
      };
      view.dispatch(
        view.state.tr.setSelection(SelectionCtor.near(view.state.doc.resolve(target)) as never)
      );
      view.focus();
      return true;
    },
    { tableIndex, row, col }
  );
  if (ok) await page.waitForTimeout(50);
  return ok;
}

export async function insertTableViaE2eHook(
  page: Page,
  rows: number,
  cols: number
): Promise<boolean> {
  return page.evaluate(({ r, c }) => window.__DOCX_EDITOR_E2E__?.insertTable?.(r, c) ?? false, {
    r: rows,
    c: cols,
  });
}

export async function addRowBelowViaE2eHook(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__DOCX_EDITOR_E2E__?.addRowBelow?.() ?? false);
}
