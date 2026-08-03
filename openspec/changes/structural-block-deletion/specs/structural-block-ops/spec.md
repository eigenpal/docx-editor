## ADDED Requirements

### Requirement: A block-level removal operation

`TreeDocOp` SHALL include `deleteBlock`, addressing one block by node id and removing that node together with its whole subtree. Accepted targets SHALL be exactly the block kinds the canonical tree types: `paragraph` (`w:p`), `table` (`w:tbl`), and `tableRow` (`w:tr`). The operation SHALL be declarative and JSON-safe like every other op, SHALL validate before any tree work so a rejection leaves the tree, revision and indexes untouched, and SHALL be listed in `TREE_DOC_OP_KINDS`.

#### Scenario: A table leaves the body

- **WHEN** `deleteBlock` names a `w:tbl` that is a child of `w:body`
- **THEN** the table and every row, cell and paragraph inside it are gone from the part
- **AND** every sibling block keeps its node id and its content

#### Scenario: A row leaves its table

- **WHEN** `deleteBlock` names a `w:tr` in a table that has more than one row
- **THEN** that row is gone and the remaining rows keep their ids and order

#### Scenario: A paragraph leaves its parent

- **WHEN** `deleteBlock` names a `w:p` that is neither the last paragraph of its cell nor the last paragraph in the part
- **THEN** the paragraph is gone and its siblings are untouched

#### Scenario: A rejected removal changes nothing

- **WHEN** any `deleteBlock` is refused
- **THEN** the caller keeps the part it passed in, unchanged, and the store publishes no revision, no history entry and no notification

### Requirement: Block removal refuses what it would break

`deleteBlock` SHALL refuse with a typed reason rather than produce a tree the rest of the engine cannot read:

- `unknown-block` — no node carries the id
- `not-a-block` — the node is not a `w:p`, `w:tbl` or `w:tr` (a run, a text value, `w:body`, a properties container), or it is the part's root
- `block-required` — the removal would leave a `w:tc` with no `w:p`, a `w:tbl` with no `w:tr`, or the part with no paragraph at all
- `carries-section-mark` — the target is a `w:p` holding `w:pPr/w:sectPr`

#### Scenario: The last paragraph in a cell stays

- **WHEN** `deleteBlock` names the only `w:p` in a `w:tc`
- **THEN** the operation is refused with `block-required`

#### Scenario: The last row in a table stays

- **WHEN** `deleteBlock` names the only `w:tr` in a `w:tbl`
- **THEN** the operation is refused with `block-required`

#### Scenario: The document keeps somewhere to put the caret

- **WHEN** `deleteBlock` would leave the part holding no paragraph at any depth
- **THEN** the operation is refused with `block-required`

#### Scenario: A section boundary is not silently dropped

- **WHEN** `deleteBlock` names a `w:p` whose `w:pPr` holds a `w:sectPr`
- **THEN** the operation is refused with `carries-section-mark`, because that mark is where a section ends and removing it would re-flow every page of the section into the next one

#### Scenario: Non-block nodes are not removable

- **WHEN** `deleteBlock` names a `w:r`, a text value, `w:body`, or a `w:pPr`
- **THEN** the operation is refused with `not-a-block`

### Requirement: Block removal reports a structural effect

A committed `deleteBlock` SHALL report `impact: 'flow-structural'` and SHALL list in `deleted` the removed block id together with every paragraph id that was inside it, so a consumer scoping work by node id invalidates the removed paragraphs rather than only the block. Undo SHALL restore the removed subtree with its node identities intact, and redo SHALL remove it again.

#### Scenario: Removed paragraphs are named

- **WHEN** a `w:tbl` holding six cell paragraphs is removed
- **THEN** the published change lists the table id and all six paragraph ids in `deleted` and carries `impact: 'flow-structural'`

#### Scenario: Undo restores the block

- **WHEN** a table removal is undone
- **THEN** the table, its rows, its cells and its paragraphs are present again under their original node ids

### Requirement: Removal round-trips through save

A part that has had a block removed SHALL serialize to valid WordprocessingML in which the block is absent and every retained block is byte-identical to what it was, and re-reading that output SHALL produce a part with the same structure.

#### Scenario: A saved document has lost only the table

- **WHEN** a document with a table is loaded, the table removed, and the part serialized and re-read
- **THEN** the reopened part contains no `w:tbl` and every other block is preserved exactly as authored
