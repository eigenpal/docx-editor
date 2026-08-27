## ADDED Requirements

### Requirement: Canonical ordered OOXML tree
The system SHALL represent each authored OOXML part as one ordered tree in which supported elements are typed nodes and unsupported elements are generic nodes in the same child sequence.

#### Scenario: Known and unknown siblings load together
- **WHEN** a paragraph contains a supported run beside an unsupported namespace-qualified element
- **THEN** the canonical tree contains both nodes in source order without creating a second preservation model

### Requirement: Generic unknown-node fidelity
Generic nodes SHALL retain qualified names, namespace bindings, ordered attributes, ordered element/text children, and stable identity subject to bounded parse and trust rules.

#### Scenario: Unsupported content survives a paragraph edit
- **WHEN** supported text adjacent to a generic subtree is edited and saved
- **THEN** normalized output preserves the generic subtree's structural content and relative order

### Requirement: Derived semantic indexes
Paragraph, story, relationship, and style lookup structures SHALL be derived from a specific canonical-tree revision and SHALL NOT be mutation or serialization authority.

#### Scenario: Index is rebuilt
- **WHEN** a committed operation invalidates a paragraph index entry
- **THEN** rebuilding the index from the same tree revision yields the same semantic identity and content

### Requirement: Atomic semantic mutation
The `DocumentStore` SHALL accept authored changes only as validated `DocOp`s against stable semantic identities and SHALL atomically publish a new tree revision and `ModelChange`.

#### Scenario: Invalid operation has no effect
- **WHEN** a `DocOp` targets a missing paragraph or violates a tree invariant
- **THEN** the operation is rejected without changing the revision, tree, indexes, or notifications

### Requirement: Normalized OOXML serialization
Save SHALL serialize escaped, normalized OOXML from the committed canonical tree and SHALL NOT read ProseMirror, layout, DOM, or derived semantic indexes as authored state.

#### Scenario: Save and reopen paragraph
- **WHEN** a supported paragraph edit is saved and the produced package is reopened
- **THEN** both the namespace-aware canonical tree fingerprint and save/reopen semantic digest pass

### Requirement: Namespace-aware canonical tree fingerprint
The repository SHALL own a normalized XML oracle that fingerprints namespace URI plus local name, ordered significant element/text children, and attributes as an order-insensitive set keyed by namespace URI plus local name. It SHALL ignore prefix choice, attribute order, insignificant inter-element whitespace, quote style, and empty-element spelling.

#### Scenario: Lexically different normalized XML is equivalent
- **WHEN** two OOXML trees differ only in namespace prefixes, attribute ordering, insignificant inter-element whitespace, quote style, or empty-element spelling
- **THEN** their canonical tree fingerprints are equal

#### Scenario: Significant child order changes
- **WHEN** two OOXML trees contain the same significant children in a different order
- **THEN** their canonical tree fingerprints are different

### Requirement: Save-reopen semantic digest
Normalized serialization SHALL also pass a save/reopen digest over supported paragraph identities, content tokens, accepted run and paragraph properties, and preserved generic-node structure.

#### Scenario: One oracle detects semantic loss
- **WHEN** either canonical fingerprinting or the reopened semantic digest detects a mismatch
- **THEN** serialization conformance fails even if the other oracle passes

### Requirement: Bounded untrusted input
Tree parsing and serialization SHALL enforce finite package/XML limits, safe part and relationship paths, no external entity expansion, no implicit external fetch, and escaped attacker-controlled output.

#### Scenario: Malicious package is rejected
- **WHEN** a package exceeds a mandatory limit or contains an unsafe traversing part path
- **THEN** parsing fails before publishing any canonical model

### Requirement: Atomic table TreeDocOps
Table structural and property edits SHALL commit only as validated `TreeDocOp`s against canonical table, row, cell, and grid-column identities. Each operation SHALL validate its complete target before mutation, publish one `flow-structural` or property impact, and create one undo step.

#### Scenario: Row insertion commits atomically
- **WHEN** a validated insert-row operation targets a canonical row in an unmerged table
- **THEN** the store inserts one fresh row with empty cell paragraphs, preserves unrelated node identities, and publishes a single `ModelChange`

#### Scenario: Row insertion extends a vertical merge
- **WHEN** a validated insert-row operation targets a boundary inside an active vertical-merge chain
- **THEN** the inserted row repeats `w:vMerge` for exactly the cells whose chain crosses that boundary, and leaves every other cell unmerged

#### Scenario: Unreadable row shape refuses insertion
- **WHEN** an insert-row operation names a row that holds a `w:tc` inside a cell-level wrapper such as `w:sdt`, or a wrapper hides a `w:tr` between the boundary rows a merge marker would be written from
- **THEN** the operation is rejected with a specific reason and the tree revision is unchanged

#### Scenario: Merged table refuses column edit
- **WHEN** a column insertion, deletion, or resize operation targets a table with horizontal or vertical merges
- **THEN** the operation is rejected with a specific reason and the tree revision is unchanged

#### Scenario: Final row or column deletion is refused
- **WHEN** a delete-row or delete-column operation would remove the table's last row or last grid column
- **THEN** the operation is rejected without mutation

### Requirement: Lossless table mutation
Table property edits SHALL patch only the required `w:tblGrid`, `w:tblPr`, `w:trPr`, and `w:tcPr` property containers. Structural operations MAY add or remove the required `w:tr` and `w:tc` nodes. All table operations SHALL preserve unknown and generic descendants, unrelated attributes and namespace declarations, original sibling order outside the changed nodes and properties, revision wrappers and provenance not owned by the operation, comments, bookmarks, fields, drawings, nested tables, and all unaffected node identities.

#### Scenario: Unknown tcPr child survives border edit
- **WHEN** a selected-cell border operation updates `w:tcBorders` on a cell that also carries an unrecognized `w:tcPr` child
- **THEN** normalized save preserves that child in source order beside the updated borders

### Requirement: Table edits pass D9 oracles
Every supported table-editing fixture SHALL pass both the namespace-aware canonical tree fingerprint and the save/reopen semantic digest after normalized serialization.

#### Scenario: Nested table edit survives reopen
- **WHEN** a nested-table fixture receives row insertion, column resize, border, and fill edits and is saved
- **THEN** reopening the produced package passes both D9 oracles at the committed revision
