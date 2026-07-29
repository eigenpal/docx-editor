/**
 * Table toolbar actions and the two dialogs behind them.
 *
 * PORTED from the legacy hook of the same name. The action vocabulary is legacy's
 * (`TableAction` from the table toolbar), the split-cell dialog state shape is legacy's,
 * and the exported names are unchanged.
 *
 * Every dispatch moves onto the contract. Legacy had two paths — a ProseMirror command
 * when the caret was in a table, and its own layout-selection manager when a table was
 * selected in the pages overlay. The engine collapses those: `getSelectedTable` answers
 * which table the selection is in, and each command applies to it or is refused.
 *
 * Borders and region selection had no command surface, so they are now
 * `setTableBorders` and `selectTableRegion` on the contract, carrying legacy's own
 * vocabulary. The engine refuses both today, which is why a border button does nothing
 * rather than something approximate.
 */
import { useCallback, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core-contract/contracts/editor';
import type { ColorValue } from '@docx-editor.dev/core-contract/contracts/types';
import type { TableAction } from '../../ui/TableToolbar';

interface SplitCellDialogState {
  isOpen: boolean;
  initialRows: number;
  initialCols: number;
  minRows: number;
  minCols: number;
}

const CLOSED_SPLIT_DIALOG: SplitCellDialogState = {
  isOpen: false,
  initialRows: 1,
  initialCols: 1,
  minRows: 1,
  minCols: 1,
};

/** The border spec the toolbar carries: style, size in eighths of a point, and colour. */
export interface BorderSpec {
  style: string;
  size: number;
  color: ColorValue;
}

export function useTableDialogs({
  editorRef,
  borderSpecRef,
}: {
  editorRef: React.RefObject<Editor | null>;
  borderSpecRef: React.RefObject<BorderSpec>;
}) {
  const [tablePropsOpen, setTablePropsOpen] = useState(false);
  const [splitCellDialogState, setSplitCellDialogState] =
    useState<SplitCellDialogState>(CLOSED_SPLIT_DIALOG);

  const openSplitCellDialog = useCallback(() => {
    // Legacy seeded the dialog from the cell's current span so it could not ask for
    // fewer rows or columns than the cell already spans. `getSelectedTable` reports the
    // table's shape but not the cell's span, so the dialog opens at its own minimums
    // rather than at seeded values that would be guesses.
    setSplitCellDialogState({ ...CLOSED_SPLIT_DIALOG, isOpen: true });
  }, []);

  const handleTableAction = useCallback(
    (action: TableAction) => {
      const editor = editorRef.current;
      if (!editor) return;
      const border = (
        scope: 'all' | 'outside' | 'inside' | 'none' | 'top' | 'bottom' | 'left' | 'right'
      ) =>
        editor.exec(
          scope === 'none'
            ? { type: 'setTableBorders', scope }
            : { type: 'setTableBorders', scope, spec: borderSpecRef.current }
        );

      switch (action) {
        case 'addRowAbove':
          editor.exec({ type: 'insertRow', where: 'above' });
          break;
        case 'addRowBelow':
          editor.exec({ type: 'insertRow', where: 'below' });
          break;
        case 'addColumnLeft':
          editor.exec({ type: 'insertColumn', where: 'left' });
          break;
        case 'addColumnRight':
          editor.exec({ type: 'insertColumn', where: 'right' });
          break;
        case 'deleteRow':
          editor.exec({ type: 'deleteRow' });
          break;
        case 'deleteColumn':
          editor.exec({ type: 'deleteColumn' });
          break;
        case 'deleteTable':
          editor.exec({ type: 'deleteTable' });
          break;
        case 'selectTable':
          editor.exec({ type: 'selectTableRegion', region: 'table' });
          break;
        case 'selectRow':
          editor.exec({ type: 'selectTableRegion', region: 'row' });
          break;
        case 'selectColumn':
          editor.exec({ type: 'selectTableRegion', region: 'column' });
          break;
        case 'mergeCells':
          editor.exec({ type: 'mergeCells' });
          break;
        case 'splitCell':
          openSplitCellDialog();
          break;
        case 'borderAll':
          border('all');
          break;
        case 'borderOutside':
          border('outside');
          break;
        case 'borderInside':
          border('inside');
          break;
        case 'borderNone':
          border('none');
          break;
        case 'borderTop':
          border('top');
          break;
        case 'borderBottom':
          border('bottom');
          break;
        case 'borderLeft':
          border('left');
          break;
        case 'borderRight':
          border('right');
          break;
        default:
          if (typeof action === 'object') {
            if (action.type === 'cellFillColor') {
              // A null fill is "no shading"; the contract spells that as the auto kind.
              editor.exec({
                type: 'setCellFill',
                color: action.color
                  ? { kind: 'hex', value: action.color.replace(/^#/, '') }
                  : { kind: 'auto' },
              });
            } else if (action.type === 'borderColor') {
              // Legacy stored the colour on the shared spec so the NEXT border action
              // uses it, rather than applying anything on its own. A null colour is the
              // picker's "automatic", which the contract spells as its own colour kind.
              borderSpecRef.current.color = action.color
                ? { kind: 'hex', value: action.color.replace(/^#/, '') }
                : { kind: 'auto' };
            } else if (action.type === 'borderWidth') {
              borderSpecRef.current.size = action.size;
            } else if (action.type === 'tableProperties') {
              setTablePropsOpen(true);
            }
          }
          break;
      }
    },
    [editorRef, borderSpecRef, openSplitCellDialog]
  );

  const handleSplitCellDialogClose = useCallback(() => {
    setSplitCellDialogState(CLOSED_SPLIT_DIALOG);
  }, []);

  const handleSplitCellDialogApply = useCallback(
    (rows: number, cols: number) => {
      editorRef.current?.exec({ type: 'splitCell', rows, cols });
      setSplitCellDialogState(CLOSED_SPLIT_DIALOG);
    },
    [editorRef]
  );

  return {
    tablePropsOpen,
    setTablePropsOpen,
    splitCellDialogState,
    openSplitCellDialog,
    handleTableAction,
    handleSplitCellDialogClose,
    handleSplitCellDialogApply,
  };
}
