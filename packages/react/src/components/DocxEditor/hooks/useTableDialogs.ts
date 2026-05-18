import { useCallback, useState } from 'react';
import type { Document } from '@eigenpal/docx-editor-core/types/document';
import {
  getSplitCellDialogConfig,
  splitActiveTableCell,
} from '@eigenpal/docx-editor-core/prosemirror/commands';
import {
  addRowAbove,
  addRowBelow,
  deleteRow as pmDeleteRow,
  addColumnLeft,
  addColumnRight,
  deleteColumn as pmDeleteColumn,
  deleteTable as pmDeleteTable,
  selectTable as pmSelectTable,
  selectRow as pmSelectRow,
  selectColumn as pmSelectColumn,
  mergeCells as pmMergeCells,
  setCellBorder,
  setCellVerticalAlign,
  setCellMargins,
  setCellTextDirection,
  toggleNoWrap,
  setRowHeight,
  toggleHeaderRow,
  distributeColumns,
  autoFitContents,
  applyTableStyle,
  removeTableBorders,
  setAllTableBorders,
  setOutsideTableBorders,
  setInsideTableBorders,
  setCellFillColor,
  setTableBorderColor,
  setTableBorderWidth,
  createStyleResolver,
} from '@eigenpal/docx-editor-core/prosemirror';
import type { EditorView } from 'prosemirror-view';
import type { useTableSelection } from '../../../hooks/useTableSelection';
import type { TableAction } from '../../ui/TableToolbar';
import { getBuiltinTableStyle, type TableStylePreset } from '../../ui/TableStyleGallery';

interface SplitCellDialogState {
  isOpen: boolean;
  initialRows: number;
  initialCols: number;
  minRows: number;
  minCols: number;
  source: 'pm' | 'legacy' | null;
  capturedCellRow: number | null;
  capturedCellCol: number | null;
}

interface BorderSpec {
  style: string;
  size: number;
  color: { rgb: string };
}

/**
 * Owns the two table-specific dialogs (`tablePropsOpen`,
 * `splitCellDialogState`) plus the big `handleTableAction` switch that
 * routes every toolbar/menu table command to a ProseMirror command —
 * borders, cell shading, alignment, header row, distribute, table-style
 * presets resolved through the document's style sheet.
 *
 * The `borderSpecRef` lives in the parent because the toolbar's color +
 * width pickers mutate it directly; the hook reads and writes its
 * `.current` to keep the per-side border helpers aligned with the
 * active style preset.
 */
export function useTableDialogs({
  getActiveEditorView,
  focusActiveEditor,
  tableSelection,
  borderSpecRef,
  historyStateRef,
  getCachedStyleResolver,
}: {
  getActiveEditorView: () => EditorView | null | undefined;
  focusActiveEditor: () => void;
  tableSelection: ReturnType<typeof useTableSelection>;
  borderSpecRef: React.RefObject<BorderSpec>;
  historyStateRef: React.RefObject<Document | null>;
  getCachedStyleResolver: (
    styles: Parameters<typeof createStyleResolver>[0]
  ) => ReturnType<typeof createStyleResolver>;
}) {
  const [tablePropsOpen, setTablePropsOpen] = useState(false);
  const [splitCellDialogState, setSplitCellDialogState] = useState<SplitCellDialogState>({
    isOpen: false,
    initialRows: 1,
    initialCols: 2,
    minRows: 1,
    minCols: 1,
    source: null,
    capturedCellRow: null,
    capturedCellCol: null,
  });

  const openSplitCellDialog = useCallback(() => {
    const view = getActiveEditorView();
    const pmConfig = view ? getSplitCellDialogConfig(view.state) : null;
    const legacyConfig = pmConfig ? null : tableSelection.getSplitCellConfig();
    const config = pmConfig ?? legacyConfig;
    if (!config) return;

    setSplitCellDialogState({
      isOpen: true,
      ...config,
      source: pmConfig ? 'pm' : 'legacy',
      capturedCellRow: pmConfig?.capturedCellRow ?? null,
      capturedCellCol: pmConfig?.capturedCellCol ?? null,
    });
  }, [getActiveEditorView, tableSelection]);

  const handleTableAction = useCallback(
    (action: TableAction) => {
      const view = getActiveEditorView();
      if (!view) {
        if (action === 'splitCell') {
          openSplitCellDialog();
        } else if (typeof action !== 'object') {
          tableSelection.handleAction(action);
        }
        return;
      }

      switch (action) {
        case 'addRowAbove':
          addRowAbove(view.state, view.dispatch);
          break;
        case 'addRowBelow':
          addRowBelow(view.state, view.dispatch);
          break;
        case 'addColumnLeft':
          addColumnLeft(view.state, view.dispatch);
          break;
        case 'addColumnRight':
          addColumnRight(view.state, view.dispatch);
          break;
        case 'deleteRow':
          pmDeleteRow(view.state, view.dispatch);
          break;
        case 'deleteColumn':
          pmDeleteColumn(view.state, view.dispatch);
          break;
        case 'deleteTable':
          pmDeleteTable(view.state, view.dispatch);
          break;
        case 'selectTable':
          pmSelectTable(view.state, view.dispatch);
          break;
        case 'selectRow':
          pmSelectRow(view.state, view.dispatch);
          break;
        case 'selectColumn':
          pmSelectColumn(view.state, view.dispatch);
          break;
        case 'mergeCells':
          pmMergeCells(view.state, view.dispatch);
          break;
        case 'splitCell':
          openSplitCellDialog();
          break;
        // Border actions use the current border spec from the toolbar
        case 'borderAll':
          setAllTableBorders(view.state, view.dispatch, borderSpecRef.current);
          break;
        case 'borderOutside':
          setOutsideTableBorders(view.state, view.dispatch, borderSpecRef.current);
          break;
        case 'borderInside':
          setInsideTableBorders(view.state, view.dispatch, borderSpecRef.current);
          break;
        case 'borderNone':
          removeTableBorders(view.state, view.dispatch);
          break;
        case 'borderTop':
          setCellBorder('top', borderSpecRef.current, true)(view.state, view.dispatch);
          break;
        case 'borderBottom':
          setCellBorder('bottom', borderSpecRef.current, true)(view.state, view.dispatch);
          break;
        case 'borderLeft':
          setCellBorder('left', borderSpecRef.current, true)(view.state, view.dispatch);
          break;
        case 'borderRight':
          setCellBorder('right', borderSpecRef.current, true)(view.state, view.dispatch);
          break;
        default:
          if (typeof action === 'object') {
            if (action.type === 'cellFillColor') {
              setCellFillColor(action.color)(view.state, view.dispatch);
            } else if (action.type === 'borderColor') {
              const rgb = action.color.replace(/^#/, '');
              borderSpecRef.current = { ...borderSpecRef.current, color: { rgb } };
              setTableBorderColor(action.color)(view.state, view.dispatch);
            } else if (action.type === 'borderWidth') {
              borderSpecRef.current = { ...borderSpecRef.current, size: action.size };
              setTableBorderWidth(action.size)(view.state, view.dispatch);
            } else if (action.type === 'cellBorder') {
              setCellBorder(action.side, {
                style: action.style,
                size: action.size,
                color: { rgb: action.color.replace(/^#/, '') },
              })(view.state, view.dispatch);
            } else if (action.type === 'cellVerticalAlign') {
              setCellVerticalAlign(action.align)(view.state, view.dispatch);
            } else if (action.type === 'cellMargins') {
              setCellMargins(action.margins)(view.state, view.dispatch);
            } else if (action.type === 'cellTextDirection') {
              setCellTextDirection(action.direction)(view.state, view.dispatch);
            } else if (action.type === 'toggleNoWrap') {
              toggleNoWrap()(view.state, view.dispatch);
            } else if (action.type === 'rowHeight') {
              setRowHeight(action.height, action.rule)(view.state, view.dispatch);
            } else if (action.type === 'toggleHeaderRow') {
              toggleHeaderRow()(view.state, view.dispatch);
            } else if (action.type === 'distributeColumns') {
              distributeColumns()(view.state, view.dispatch);
            } else if (action.type === 'autoFitContents') {
              autoFitContents()(view.state, view.dispatch);
            } else if (action.type === 'openTableProperties') {
              setTablePropsOpen(true);
            } else if (action.type === 'applyTableStyle') {
              // Resolve style data from built-in presets or the document's stylesheet.
              let preset: TableStylePreset | undefined = getBuiltinTableStyle(action.styleId);
              const currentDoc = historyStateRef.current;
              if (!preset && currentDoc?.package.styles) {
                const styleResolver = getCachedStyleResolver(currentDoc.package.styles);
                const docStyle = styleResolver.getStyle(action.styleId);
                if (docStyle) {
                  preset = { id: docStyle.styleId, name: docStyle.name ?? docStyle.styleId };
                  if (docStyle.tblPr?.borders) {
                    const b = docStyle.tblPr.borders;
                    preset.tableBorders = {};
                    for (const side of [
                      'top',
                      'bottom',
                      'left',
                      'right',
                      'insideH',
                      'insideV',
                    ] as const) {
                      const bs = b[side];
                      if (bs) {
                        preset.tableBorders[side] = {
                          style: bs.style,
                          size: bs.size,
                          color: bs.color?.rgb ? { rgb: bs.color.rgb } : undefined,
                        };
                      }
                    }
                  }
                  if (docStyle.tblStylePr) {
                    preset.conditionals = {};
                    for (const cond of docStyle.tblStylePr) {
                      const entry: Record<string, unknown> = {};
                      if (cond.tcPr?.shading?.fill)
                        entry.backgroundColor = `#${cond.tcPr.shading.fill}`;
                      if (cond.tcPr?.borders) {
                        const borders: Record<string, unknown> = {};
                        for (const s of ['top', 'bottom', 'left', 'right'] as const) {
                          const bs2 = cond.tcPr.borders[s];
                          if (bs2)
                            borders[s] = {
                              style: bs2.style,
                              size: bs2.size,
                              color: bs2.color?.rgb ? { rgb: bs2.color.rgb } : undefined,
                            };
                        }
                        entry.borders = borders;
                      }
                      if (cond.rPr?.bold) entry.bold = true;
                      if (cond.rPr?.color?.rgb) entry.color = `#${cond.rPr.color.rgb}`;
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      (preset.conditionals as any)[cond.type] = entry;
                    }
                  }
                  preset.look = { firstRow: true, lastRow: false, noHBand: false, noVBand: true };
                }
              }
              if (preset) {
                applyTableStyle({
                  styleId: preset.id,
                  tableBorders: preset.tableBorders,
                  conditionals: preset.conditionals,
                  look: preset.look,
                })(view.state, view.dispatch);
              }
            }
          } else {
            // Fallback to the legacy table-selection handler for anything not yet routed.
            tableSelection.handleAction(action);
          }
      }

      focusActiveEditor();
    },
    [
      tableSelection,
      getActiveEditorView,
      focusActiveEditor,
      openSplitCellDialog,
      borderSpecRef,
      historyStateRef,
      getCachedStyleResolver,
    ]
  );

  const handleSplitCellDialogClose = useCallback(() => {
    setSplitCellDialogState((prev) => ({
      ...prev,
      isOpen: false,
      source: null,
      capturedCellRow: null,
      capturedCellCol: null,
    }));
  }, []);

  const handleSplitCellDialogApply = useCallback(
    (rows: number, cols: number) => {
      if (splitCellDialogState.source === 'legacy') {
        tableSelection.applySplitCell(rows, cols);
        focusActiveEditor();
        return;
      }
      const view = getActiveEditorView();
      if (!view) return;
      splitActiveTableCell(
        view.state,
        view.dispatch,
        rows,
        cols,
        splitCellDialogState.capturedCellRow ?? undefined,
        splitCellDialogState.capturedCellCol ?? undefined
      );
      focusActiveEditor();
    },
    [
      focusActiveEditor,
      getActiveEditorView,
      splitCellDialogState.source,
      splitCellDialogState.capturedCellRow,
      splitCellDialogState.capturedCellCol,
      tableSelection,
    ]
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
