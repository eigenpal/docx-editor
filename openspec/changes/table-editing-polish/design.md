# Design: Table Editing Polish

## Column resize

The `TableResize` extension handles column border dragging. The issue is likely in how resize handles are positioned or how the drag delta is applied to column widths.

**Common causes:**

1. Resize handles only created for the rightmost border of each cell
2. Drag delta applied to wrong column index
3. Width redistribution only affects the last column instead of adjacent columns

**Fix:** Ensure resize handles appear on all inter-column borders. When dragging, adjust the width of the column to the left (decrease/increase) and the column to the right (inverse change) to maintain total table width. This matches Word's behavior.

## Row formatting inheritance

When adding a row, clone the formatting from the reference row (above for "add below", below for "add above"):

1. Copy paragraph properties (alignment, spacing) from each corresponding cell
2. Copy default run properties (font family, font size) from each corresponding cell
3. Copy cell properties (borders, shading, vertical alignment) from each corresponding cell
4. Don't copy content — new cells should be empty

**Implementation:** In `TableExtension` add-row command, after creating new cells, apply the formatting attributes from the corresponding cells in the reference row.

## Key files

| File                                                       | Change                                       |
| ---------------------------------------------------------- | -------------------------------------------- |
| `src/prosemirror/extensions/nodes/TableResizeExtension.ts` | Column resize handles and drag logic         |
| `src/prosemirror/extensions/nodes/TableExtension.ts`       | Row add commands with formatting inheritance |
