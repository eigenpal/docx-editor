## Definitions

See `tracked-structural-paragraphs/spec.md` for the shared definitions of _active suggesting-mode author_, _ISO 8601 UTC_, _semantically equivalent OOXML_, _revision triple_, and _one PM transaction_. They apply here too.

- **cellMarker** — discriminated union attr on `table_cell` carrying at most one of `{ kind: 'ins', info }`, `{ kind: 'del', info }`, `{ kind: 'merge', info, vMerge: 'rest' | 'cont', vMergeOrig?: 'rest' | 'cont' }` (mutually exclusive per `EG_CellMarkupElements` at `wml.xsd:977`). `info` is the `RevisionInfo` triple.

## ADDED Requirements

### Requirement: Preserve table-row insertion and deletion markers on round-trip

The system SHALL parse `<w:trPr><w:ins/></w:trPr>` and `<w:trPr><w:del/></w:trPr>` from a DOCX as row-level revisions, store them on the corresponding `table_row` node as `trIns` / `trDel`, and serialize them back. Output SHALL be semantically equivalent to source.

#### Scenario: Row insertion marker round-trips

- **GIVEN** a DOCX containing a table row whose `<w:trPr>` carries `<w:ins w:id="20" w:author="Jane" w:date="2026-05-28T10:00:00Z"/>`
- **WHEN** parsed and re-serialized
- **THEN** the output's row carries an `<w:ins/>` semantically equivalent to source

#### Scenario: Row deletion marker round-trips

- **GIVEN** a row with `<w:trPr><w:del w:id="21" w:author="Jane" w:date="2026-05-28T10:00:00Z"/></w:trPr>`
- **WHEN** parsed and re-serialized
- **THEN** the output retains the `<w:del/>` semantically equivalent to source

### Requirement: Preserve table-cell ins / del / merge markers on round-trip

The system SHALL parse the mutually exclusive `<w:tcPr><w:cellIns/>`, `<w:tcPr><w:cellDel/>`, and `<w:tcPr><w:cellMerge>` elements from a DOCX, store them on the corresponding `table_cell` node as the single `cellMarker` attr, and serialize them back. `<w:cellMerge>` carries `vMerge` (and optionally `vMergeOrig`) of type `ST_AnnotationVMerge` (`rest` or `cont`) — it **has no `w:val` attribute** (per `CT_CellMergeTrackChange` at `wml.xsd:811`).

#### Scenario: Vertical-merge marker round-trips

- **GIVEN** a top cell with `<w:tcPr><w:cellMerge w:vMerge="rest" w:id="30" w:author="Jane" w:date="2026-05-28T10:00:00Z"/></w:tcPr>` and the cell directly below it with `<w:cellMerge w:vMerge="cont" w:id="30" w:author="Jane" w:date="2026-05-28T10:00:00Z"/>`
- **WHEN** parsed and re-serialized
- **THEN** both cells retain their `<w:cellMerge/>` elements with matching `w:vMerge`, `w:id`, `w:author`, `w:date` attributes; the output emits NO `w:val` attribute

#### Scenario: Cell insertion marker round-trips

- **GIVEN** a cell with `<w:tcPr><w:cellIns w:id="31" w:author="Jane" w:date="…"/></w:tcPr>`
- **WHEN** parsed and re-serialized
- **THEN** the output retains the `<w:cellIns/>` semantically equivalent to source

### Requirement: Preserve table, row, cell, and grid property-change markers on round-trip

The system SHALL parse `<w:trPrChange>`, `<w:tcPrChange>`, `<w:tblPrChange>`, `<w:tblPrExChange>`, `<w:tblGridChange>` and serialize them back. Each property-change is stored as an array `[{ revisionId, author, date, prior }]` on the relevant node, except `tblGridChange` which is stored as `{ revisionId, prior }` (no author, no date — `CT_TblGridChange` extends `CT_Markup`, not `CT_TrackChange`, per `wml.xsd:893`). `tblPrExChange` is stored on the `table_row` node (not the table), because `<w:tblPrEx>` lives inside `<w:tr>` per schema.

#### Scenario: Table-grid change round-trips with id-only attributes

- **GIVEN** a table whose `<w:tblGrid>` is followed by `<w:tblGridChange w:id="40"><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="3000"/></w:tblGrid></w:tblGridChange>`
- **WHEN** parsed and re-serialized
- **THEN** the output retains `<w:tblGridChange w:id="40">` with the same prior `<w:tblGrid>` contents and **emits no `w:author` or `w:date` attribute**

#### Scenario: Per-row tblPrEx change round-trips at row level

- **GIVEN** a table row whose `<w:tr>` contains `<w:tblPrEx>…<w:tblPrExChange w:id="45" w:author="Jane" w:date="…"><w:tblPrEx>…prior…</w:tblPrEx></w:tblPrExChange></w:tblPrEx>`
- **WHEN** parsed and re-serialized
- **THEN** the output retains `<w:tblPrExChange>` at the same row-level position, semantically equivalent to source; the `table_row` node carries the parsed change in its `tblPrExChange` array, the `table` node does NOT

### Requirement: Track row insertion in suggesting mode

When suggesting mode is active, `addRow` SHALL insert the row into the table and set `trIns` on the new row and `cellMarker: { kind: 'ins' }` on each of its cells, sharing one revision triple.

#### Scenario: Insert row in suggesting mode

- **GIVEN** active suggesting-mode author "Jane" and a 2x2 table
- **WHEN** `addRow` is dispatched after row 1
- **THEN** the table has 3 rows; the new row carries `trIns: { revisionId, author: 'Jane', date }`; each cell in the new row carries `cellMarker: { kind: 'ins', info: { revisionId: <same>, author: 'Jane', date: <same> } }`; one PM transaction is generated

### Requirement: Track row deletion in suggesting mode

When suggesting mode is active, `deleteRow` SHALL NOT remove the row. It SHALL set `trDel` on the row and `cellMarker: { kind: 'del' }` on each of its cells. The cell-content reconciliation rule is _no change to cell content while the row is marked-deleted_ (content remains visible until accept).

#### Scenario: Delete row in suggesting mode

- **GIVEN** active suggesting-mode author and a row with no prior tracked changes
- **WHEN** `deleteRow` is dispatched targeting that row
- **THEN** the row is still present in the document with `trDel`; each cell carries `cellMarker: { kind: 'del' }` sharing the same revision triple

### Requirement: Track column insertion and deletion in suggesting mode

When suggesting mode is active, `addColumn` SHALL insert cells across all rows with `cellMarker: { kind: 'ins' }` on each new cell, sharing one revision triple. `deleteColumn` SHALL set `cellMarker: { kind: 'del' }` on each cell in the column rather than removing them.

#### Scenario: Add column in suggesting mode

- **GIVEN** active suggesting-mode author and a 2x2 table
- **WHEN** `addColumn` is dispatched after column 1
- **THEN** the table is 2x3; each new cell carries `cellMarker: { kind: 'ins' }` sharing one revision triple

### Requirement: Track horizontal cell merge as cellIns/cellDel pair

When suggesting mode is active, horizontal `mergeCells` SHALL NOT collapse the cells in the editor model. The convention matches Word's on-disk representation: the leftmost cell carries `cellMarker: { kind: 'ins' }` (the merged-result placeholder) and each absorbed cell carries `cellMarker: { kind: 'del' }`, sharing one revision triple. There is no horizontal cellMerge OOXML element.

#### Scenario: Merge two cells horizontally in suggesting mode

- **GIVEN** active suggesting-mode author and two adjacent cells in a row
- **WHEN** `mergeCells` (horizontal) is dispatched across them
- **THEN** the left cell carries `cellMarker: { kind: 'ins' }`; the right cell carries `cellMarker: { kind: 'del' }`; both share one revision triple; both cells remain visible in the rendered table until accepted

### Requirement: Track vertical cell merge using cellMerge

When suggesting mode is active, vertical `mergeCells` SHALL set `cellMarker: { kind: 'merge', vMerge: 'rest' }` on the top cell and `cellMarker: { kind: 'merge', vMerge: 'cont' }` on each cell below, sharing one revision triple.

#### Scenario: Merge two cells vertically in suggesting mode

- **GIVEN** active suggesting-mode author and two vertically adjacent cells (same column, adjacent rows)
- **WHEN** `mergeCells` (vertical) is dispatched
- **THEN** the top cell carries `cellMarker: { kind: 'merge', vMerge: 'rest' }`; the bottom cell carries `cellMarker: { kind: 'merge', vMerge: 'cont' }`; both share one revision triple; the rendered table shows them visually merged with a dashed boundary

### Requirement: Track row, cell, and table property changes in suggesting mode

When suggesting mode is active, commands that modify table, row, or cell properties SHALL snapshot the prior properties via `withSuggestingSnapshot` and append a `*Change` array entry on the appropriate node. Within one revision triple, the prior snapshot is frozen on first edit; after every subsequent edit, the implementation compares snapshotted fields against current values and removes the entry if all fields equal.

#### Scenario: Change cell shading in suggesting mode

- **GIVEN** active suggesting-mode author and a cell with no shading
- **WHEN** the user sets the cell background to `#FFEB3B`
- **THEN** the cell has `shading: '#FFEB3B'` and `tcPrChange: [{ revisionId, author, date, prior: { shading: null } }]`

#### Scenario: Toggling cell shading back clears the entry

- **GIVEN** a cell with `tcPrChange: [{ revisionId: 70, prior: { shading: null } }]` and current `shading: '#FFEB3B'`
- **WHEN** the user clears the shading in the same suggesting session
- **THEN** the cell has `shading: null` and `tcPrChange` no longer contains the entry

### Requirement: Accept and reject table revisions per Word semantics

The system SHALL extend accept/reject to operate on table revision attrs:

- `trIns` accept → clear; reject → delete row.
- `trDel` accept → delete row; reject → clear.
- `cellMarker { kind: 'ins' }` accept → clear; reject → delete cell and adjust grid.
- `cellMarker { kind: 'del' }` accept → delete cell and adjust grid; reject → clear.
- `cellMarker { kind: 'merge', vMerge: 'rest'|'cont' }` accept → apply the vertical merge per OOXML; reject → clear all `cellMarker` entries in the merge group sharing the triple.
- `tcPrChange`, `trPrChange`, `tblPrChange`, `tblPrExChange` (per-row) accept → clear matching entry; reject → restore that entry's `prior` and clear.
- `tblGridChange` accept → clear; reject → restore `prior` `<w:tblGrid>` and clear.

When a row or cell carries multiple revision attrs, resolution within `acceptAll` / `rejectAll` SHALL proceed inner-to-outer: cell-level → row-level → table-level.

#### Scenario: Accept a row insertion

- **GIVEN** a row with `trIns: { revisionId: 1 }` and cells each carrying `cellMarker: { kind: 'ins', info: { revisionId: 1, ... } }`
- **WHEN** `acceptChangeById(1)` is dispatched
- **THEN** the row remains; `trIns` is `null`; every cell's `cellMarker` is `null`; one PM transaction

#### Scenario: Reject a row insertion

- **GIVEN** a row with `trIns: { revisionId: 1 }`
- **WHEN** `rejectChangeById(1)` is dispatched
- **THEN** the row is removed from the table; the grid contracts accordingly

#### Scenario: Accept a row deletion

- **GIVEN** a row with `trDel: { revisionId: 2 }`
- **WHEN** `acceptChangeById(2)` is dispatched
- **THEN** the row is removed from the table

#### Scenario: Accept trDel on the only row of a table removes the table

- **GIVEN** a table with one row carrying `trDel: { revisionId: 3 }`
- **WHEN** `acceptChangeById(3)` is dispatched
- **THEN** the table node is removed from the document (a zero-row table would be invalid per PM schema)

#### Scenario: Accept a horizontal merge collapses cells

- **GIVEN** a left cell with `cellMarker: { kind: 'ins', info: { revisionId: 4 } }` and a right cell with `cellMarker: { kind: 'del', info: { revisionId: 4 } }`, both containing paragraph content
- **WHEN** `acceptChangeById(4)` is dispatched
- **THEN** the right cell is removed; the left cell's `colspan` is increased by the absorbed cell's colspan; the absorbed cell's content is appended as additional paragraphs at the end of the surviving (left) cell's content

#### Scenario: Reject a horizontal merge

- **GIVEN** the same cell pair as above
- **WHEN** `rejectChangeById(4)` is dispatched
- **THEN** both cells revert to separate cells with `cellMarker: null`; content is preserved

#### Scenario: Accept a vertical merge

- **GIVEN** two vertically adjacent cells with paired `cellMarker: { kind: 'merge' }` (top: `vMerge: 'rest'`, bottom: `vMerge: 'cont'`) sharing `revisionId: 5`
- **WHEN** `acceptChangeById(5)` is dispatched
- **THEN** the merge is applied per OOXML `vMerge` semantics (the top cell spans both rows; bottom cell becomes a `vMerge: 'cont'` cell); the `cellMarker` attrs are cleared

#### Scenario: Reject a table-grid change

- **GIVEN** a table with current grid `[3000, 2000]` and `tblGridChange: { revisionId: 6, prior: [2500, 2500] }`
- **WHEN** `rejectChangeById(6)` is dispatched
- **THEN** the table grid reverts to `[2500, 2500]` and `tblGridChange` is `null`

### Requirement: Painter renders revision cues for table revisions

The visible page renderer SHALL paint:

- A colored border on rows/cells with `trIns` / `trDel` / `cellMarker.kind === 'ins'|'del'` (insert color for ins, delete color for del) and a margin change bar.
- A strikethrough overlay on rows/cells with `trDel` / `cellMarker.kind === 'del'`.
- A dashed boundary between cells in an unaccepted vertical `cellMarker.kind === 'merge'` group.
- A change bar for any `*Change` attr.

The painted DOM SHALL carry `data-revision-id`, `data-revision-author`, `data-revision-date` on the relevant row, cell, or table element. For `tblGridChange`, `data-revision-author` and `data-revision-date` SHALL be empty strings (the underlying schema has no author/date).

#### Scenario: Deleted row renders with strikethrough overlay

- **GIVEN** a row carries `trDel: { revisionId: 5, author: 'Jane', date: '2026-05-28T10:00:00Z' }`
- **WHEN** the table is painted
- **THEN** the row's painted DOM has a strikethrough overlay in the deletion color; carries `data-revision-id="5"`, `data-revision-author="Jane"`, `data-revision-date="2026-05-28T10:00:00Z"`; the page margin shows a change bar

### Requirement: Sidebar entries for table revisions

The review sidebar SHALL list one entry per revision triple (including all paired `cellMarker` cells in a merge group as a single entry, and a row-insertion's `trIns` plus all its cells' `cellMarker: ins` as a single entry). Each entry SHALL identify the row or cell ("Row 3", "Cell at row 2, column 4") and the revision kind. Clicking an entry SHALL scroll to the corresponding block via `data-revision-id`. Accept and Reject buttons SHALL dispatch `acceptChangeById` / `rejectChangeById`.

#### Scenario: Sidebar lists a deleted row as one entry

- **GIVEN** a row has `trDel: { revisionId: 6, author: 'Jane', date: '2026-05-28T10:00:00Z' }` and three cells each with `cellMarker: { kind: 'del', info: { revisionId: 6, author: 'Jane', date: '2026-05-28T10:00:00Z' } }`
- **WHEN** the sidebar renders
- **THEN** **one** entry appears with author "Jane", date 2026-05-28, label "Deleted row" (with the row index), Accept and Reject buttons (not four entries)

#### Scenario: Sidebar entry for tblGridChange shows no author or date

- **GIVEN** a `tblGridChange: { revisionId: 40 }` (no author, no date — CT_Markup)
- **WHEN** the sidebar renders
- **THEN** the entry shows the kind label "Table grid changed" with no author or date displayed
