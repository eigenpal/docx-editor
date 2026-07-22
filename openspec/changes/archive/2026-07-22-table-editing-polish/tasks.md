# Tasks: Table Editing Polish

## Investigation

- [ ] Test column resize on a 4-column table — which borders respond to drag?
- [ ] Trace resize handle creation in `TableResizeExtension`
- [ ] Test add-row-below — check if new row inherits alignment, font, size
- [ ] Trace add-row command in `TableExtension`

## Column resize

- [ ] Ensure resize handles are created for all inter-column borders
- [ ] Fix drag delta to adjust left column width and right column width inversely
- [ ] Maintain total table width during resize
- [ ] Allow resizing back to original position
- [ ] Test with 2, 3, 4, and 5+ column tables

## Row formatting inheritance

- [ ] When adding row below, use row above as reference
- [ ] When adding row above, use row below as reference
- [ ] Copy paragraph properties (alignment, spacing) to new cells
- [ ] Copy default run properties (font family, font size) to new cells
- [ ] Copy cell properties (borders, shading, vertical align) to new cells
- [ ] Don't copy text content — cells should be empty

## Testing

- [ ] E2E test: resize middle column in 4-column table
- [ ] E2E test: resize and resize back to original position
- [ ] E2E test: add row inherits center alignment from reference row
- [ ] E2E test: add row inherits font family from reference row
- [ ] E2E test: add row inherits cell shading from reference row
- [ ] Run `bun run typecheck`
