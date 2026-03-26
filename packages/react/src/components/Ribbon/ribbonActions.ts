import type { FormattingAction, SelectionFormatting } from '../toolbarTypes';
import type { EditorMode } from '../ui/EditingModeDropdown';
import type { TableAction } from '../ui/TableToolbar';
import { halfPointsToPoints } from '../ui/FontSizePicker';
import type { ImageSizeDialogFocusTarget } from '../dialogs/ImageSizeDialog';

export interface RibbonActionContext {
  selectionFormatting?: SelectionFormatting;
  onFormat?: (action: FormattingAction) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onFind?: () => void;
  onReplace?: () => void;
  onPageSetup?: () => void;
  onInsertPageBreak?: () => void;
  onInsertImage?: () => void;
  onInsertTOC?: () => void;
  onUpdateTOC?: () => void;
  onAcceptAllChanges?: () => void;
  onRejectAllChanges?: () => void;
  onInsertSectionBreak?: (breakType: 'nextPage' | 'continuous' | 'oddPage' | 'evenPage') => void;
  onSetIndentLeft?: (twips: number) => void;
  onSetIndentRight?: (twips: number) => void;
  onSetSpaceBefore?: (twips: number) => void;
  onSetSpaceAfter?: (twips: number) => void;
  onToggleComments?: () => void;
  editingMode?: EditorMode;
  onSetEditingMode?: (mode: EditorMode) => void;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  onToggleOutline?: () => void;
  onTableAction?: (action: TableAction) => void;
  onOpenHeaderFooter?: (position: 'header' | 'footer') => void;
  onCloseHeaderFooter?: () => void;
  onOpenImageProperties?: () => void;
  onOpenImageSize?: (focus?: ImageSizeDialogFocusTarget) => void;
  onNewComment?: () => void;
  onDeleteComment?: () => void;
  onInsertFootnote?: () => void;
  onInsertEndnote?: () => void;
  onCopy?: () => void;
  onCut?: () => void;
  onPaste?: () => void;
  onToggleLocalClipboard?: () => void;
  localClipboardEnabled?: boolean;
  onToggleShowMarks?: () => void;
  showMarksEnabled?: boolean;
  onToggleParagraphBorder?: () => void;
  onToggleRuler?: () => void;
  onZoomPageWidth?: () => void;
  onZoomOnePage?: () => void;
  onSetLayoutMode?: (mode: 'print' | 'web') => void;
}

const DEFAULT_FONT_SIZE = 11;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

function getCurrentFontSize(selection?: SelectionFormatting): number {
  if (selection?.fontSize !== undefined) {
    return halfPointsToPoints(selection.fontSize);
  }
  return DEFAULT_FONT_SIZE;
}

function clampZoom(value: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export const ribbonActions: Record<string, (ctx: RibbonActionContext) => void> = {
  undo: (ctx) => ctx.onUndo?.(),
  redo: (ctx) => ctx.onRedo?.(),
  bold: (ctx) => ctx.onFormat?.('bold'),
  italic: (ctx) => ctx.onFormat?.('italic'),
  underline: (ctx) => ctx.onFormat?.('underline'),
  strikethrough: (ctx) => ctx.onFormat?.('strikethrough'),
  superscript: (ctx) => ctx.onFormat?.('superscript'),
  subscript: (ctx) => ctx.onFormat?.('subscript'),
  clearFormatting: (ctx) => ctx.onFormat?.('clearFormatting'),
  setLtr: (ctx) => ctx.onFormat?.('setLtr'),
  setRtl: (ctx) => ctx.onFormat?.('setRtl'),
  fontGrow: (ctx) => {
    const next = getCurrentFontSize(ctx.selectionFormatting) + 1;
    ctx.onFormat?.({ type: 'fontSize', value: next });
  },
  fontShrink: (ctx) => {
    const next = Math.max(1, getCurrentFontSize(ctx.selectionFormatting) - 1);
    ctx.onFormat?.({ type: 'fontSize', value: next });
  },
  insertLink: (ctx) => ctx.onFormat?.('insertLink'),
  find: (ctx) => ctx.onFind?.(),
  replace: (ctx) => ctx.onReplace?.(),
  pageSetup: (ctx) => ctx.onPageSetup?.(),
  pageBreak: (ctx) => ctx.onInsertPageBreak?.(),
  insertImage: (ctx) => ctx.onInsertImage?.(),
  insertTOC: (ctx) => ctx.onInsertTOC?.(),
  updateTOC: (ctx) => ctx.onUpdateTOC?.(),
  acceptAllChanges: (ctx) => ctx.onAcceptAllChanges?.(),
  rejectAllChanges: (ctx) => ctx.onRejectAllChanges?.(),
  margins: (ctx) => ctx.onPageSetup?.(),
  orientation: (ctx) => ctx.onPageSetup?.(),
  size: (ctx) => ctx.onPageSetup?.(),
  imageWidth: (ctx) => ctx.onOpenImageSize?.('width'),
  imageHeight: (ctx) => ctx.onOpenImageSize?.('height'),
  aspectRatio: (ctx) => ctx.onOpenImageSize?.('lock'),
  newComment: (ctx) => ctx.onNewComment?.(),
  deleteComment: (ctx) => ctx.onDeleteComment?.(),
  insertFootnote: (ctx) => ctx.onInsertFootnote?.(),
  insertEndnote: (ctx) => ctx.onInsertEndnote?.(),
  toggleComments: (ctx) => ctx.onToggleComments?.(),
  trackChanges: (ctx) => {
    if (!ctx.onSetEditingMode) return;
    const next = ctx.editingMode === 'suggesting' ? 'editing' : 'suggesting';
    ctx.onSetEditingMode(next);
  },
  readOnly: (ctx) => ctx.onSetEditingMode?.('viewing'),
  printLayout: (ctx) => ctx.onSetLayoutMode?.('print'),
  webLayout: (ctx) => ctx.onSetLayoutMode?.('web'),
  zoomIn: (ctx) => {
    if (!ctx.onZoomChange) return;
    const current = ctx.zoom ?? 1;
    ctx.onZoomChange(clampZoom(Math.round((current + 0.1) * 10) / 10));
  },
  zoomOut: (ctx) => {
    if (!ctx.onZoomChange) return;
    const current = ctx.zoom ?? 1;
    ctx.onZoomChange(clampZoom(Math.round((current - 0.1) * 10) / 10));
  },
  zoom100: (ctx) => ctx.onZoomChange?.(1),
  toggleNavigationPane: (ctx) => ctx.onToggleOutline?.(),
  borderAll: (ctx) => ctx.onTableAction?.('borderAll'),
  borderOutside: (ctx) => ctx.onTableAction?.('borderOutside'),
  borderInside: (ctx) => ctx.onTableAction?.('borderInside'),
  borderNone: (ctx) => ctx.onTableAction?.('borderNone'),
  cut: (ctx) => ctx.onCut?.(),
  copy: (ctx) => ctx.onCopy?.(),
  paste: (ctx) => ctx.onPaste?.(),
  localClipboard: (ctx) => ctx.onToggleLocalClipboard?.(),
  showMarks: (ctx) => ctx.onToggleShowMarks?.(),
  showBookmarks: (ctx) => ctx.onToggleShowMarks?.(),
  borders: (ctx) => ctx.onToggleParagraphBorder?.(),
  toggleRuler: (ctx) => ctx.onToggleRuler?.(),
  zoomPageWidth: (ctx) => ctx.onZoomPageWidth?.(),
  zoomOnePage: (ctx) => ctx.onZoomOnePage?.(),
  toggleHeaderRow: (ctx) => ctx.onTableAction?.({ type: 'toggleHeaderRow' }),
  addRowAbove: (ctx) => ctx.onTableAction?.('addRowAbove'),
  addRowBelow: (ctx) => ctx.onTableAction?.('addRowBelow'),
  addColumnLeft: (ctx) => ctx.onTableAction?.('addColumnLeft'),
  addColumnRight: (ctx) => ctx.onTableAction?.('addColumnRight'),
  mergeCells: (ctx) => ctx.onTableAction?.('mergeCells'),
  splitCells: (ctx) => ctx.onTableAction?.('splitCell'),
  distributeColumns: (ctx) => ctx.onTableAction?.({ type: 'distributeColumns' }),
  autoFitContents: (ctx) => ctx.onTableAction?.({ type: 'autoFitContents' }),
  alignTop: (ctx) => ctx.onTableAction?.({ type: 'cellVerticalAlign', align: 'top' }),
  alignCenter: (ctx) => ctx.onTableAction?.({ type: 'cellVerticalAlign', align: 'center' }),
  alignBottom: (ctx) => ctx.onTableAction?.({ type: 'cellVerticalAlign', align: 'bottom' }),
  deleteRow: (ctx) => ctx.onTableAction?.('deleteRow'),
  deleteColumn: (ctx) => ctx.onTableAction?.('deleteColumn'),
  deleteTable: (ctx) => ctx.onTableAction?.('deleteTable'),
  tableProperties: (ctx) => ctx.onTableAction?.({ type: 'openTableProperties' }),
  openHeader: (ctx) => ctx.onOpenHeaderFooter?.('header'),
  openFooter: (ctx) => ctx.onOpenHeaderFooter?.('footer'),
  closeHeaderFooter: (ctx) => ctx.onCloseHeaderFooter?.(),
  imageAltText: (ctx) => ctx.onOpenImageProperties?.(),
};
