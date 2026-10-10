# Tasks: Table Rendering Fidelity

## Investigation

- [ ] Audit merged cell span tracking in `renderTable.ts`
- [ ] Check table indentation source (w:tblInd vs paragraph indent)
- [ ] Identify table height measurement in layout flow
- [ ] Check if `w:tblHeader` is parsed and available in PM node attrs
- [ ] Create test DOCX with: complex merges, wide table, multi-page table with headers

## Merged cells

- [ ] Fix grid column index tracking for cells after first merged group
- [ ] Handle `w:vMerge` continue markers correctly for non-first columns
- [ ] Test with complex merge patterns (L-shaped merges, multi-column + multi-row)

## Table indentation

- [ ] Use only `w:tblInd` for table container left offset
- [ ] Remove any inherited paragraph indent on table wrapper

## Table/text overlap

- [ ] Ensure table block height includes all rows + padding + borders
- [ ] Verify following content starts after table's measured height

## Adaptive margins

- [ ] Detect when total column width exceeds content area
- [ ] Scale column widths proportionally to fit within content area

## Table pagination

- [ ] Detect when table crosses page boundary
- [ ] Re-render header rows (`w:tblHeader`) at top of continuation fragment
- [ ] Split rows at paragraph boundaries, not mid-line
- [ ] Coordinate fragment heights across all cells in a split row

## Testing

- [ ] E2E test: complex merged cells (beyond first column)
- [ ] E2E test: table indentation matches Word
- [ ] E2E test: table followed by text — no overlap
- [ ] E2E test: wide table fits within page
- [ ] E2E test: multi-page table with repeated headers
- [ ] Run `bun run typecheck`
