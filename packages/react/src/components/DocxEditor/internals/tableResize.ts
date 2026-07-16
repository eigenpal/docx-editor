/**
 * Table resize commit + width-read helpers for PagedEditor.
 *
 * Lifted to `@docx-editor.dev/core/prosemirror/tableResize` and shared
 * with the Vue adapter; re-exported here to keep existing import sites stable.
 * The gesture state machine stays in `useTableResizeState`.
 */

export {
  readColumnWidths,
  readRowHeight,
  readColumnWidthAt,
  commitColumnResize,
  commitRowResize,
  commitRightEdgeResize,
  TWIPS_PER_PIXEL,
  MIN_CELL_WIDTH_TWIPS,
  MIN_ROW_HEIGHT_TWIPS,
} from '@docx-editor.dev/core/prosemirror/tableResize';
