# Design: Table Rendering Fidelity

## Merged cells

The issue is in `renderTable.ts` span calculation. When `w:gridSpan` and `w:vMerge` are used together, the column offset tracking can drift for cells after the first merged group. Fix: track cumulative grid column index correctly across all cells in a row.

## Table indentation

Word applies table indent via `w:tblInd` (table properties) and `w:tblpPr` (table positioning). Our rendering may be adding default paragraph indent to the table wrapper. Fix: ensure table container uses only `w:tblInd` for left offset, not paragraph indent.

## Table/text overlap

Tables must reserve their full vertical space in the page flow. If table height calculation is wrong, following content overlaps. Fix: ensure table block height in layout is measured accurately, including all rows and cell padding.

## Adaptive margins

Word auto-adjusts table column widths when the total exceeds the content area. Options:

1. Scale column widths proportionally to fit
2. Allow horizontal overflow with scroll (less Word-like)
3. Adjust table indent to use full page width

Recommend option 1 (proportional scaling) as it matches Word behavior.

## Table pagination

### Header row repetition

When a table crosses a page boundary, rows with `w:tblHeader` should be re-rendered at the top of the continuation fragment.

### Row splitting

When a row must split across pages (cell content too tall):

- Split at a paragraph boundary within the cell, not mid-line
- All cells in the row must split at the same vertical position
- Coordinate fragment heights across all cells in the row

## Key files

| File                                | Change                                        |
| ----------------------------------- | --------------------------------------------- |
| `src/layout-painter/renderTable.ts` | Merged cells, indentation, height, pagination |
| `src/layout-painter/renderPage.ts`  | Table flow block, page break coordination     |
| `src/docx/tableParser.ts`           | Verify header row flag parsing                |
