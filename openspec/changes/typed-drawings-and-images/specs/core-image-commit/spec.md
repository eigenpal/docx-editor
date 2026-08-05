## MODIFIED Requirements

### Requirement: Image resize/drag commit functions in core

`@docx-editor.dev/core` SHALL expose framework-neutral image commit helpers that validate and commit through `TreeDocumentStore` package transactions, not through ProseMirror positions, node markup, or adapter-owned inline delete-and-insert. Adapters retain pointer tracking and resolve preview geometry from semantic layout records; core validates and commits the final intent once per user gesture.

The production contract targets canonical drawing identity (`drawingId`), store/package transactions, and semantic records. Hit-testing and gesture tracking remain in adapters, which pass resolved EMU extents, crop rectangles, wrap choices, and anchor offsets into the commit helpers.

#### Scenario: Resize commit

- **WHEN** a resize commit is called with a canonical drawing identity and final width and height in EMU
- **THEN** `wp:extent` updates in one store transaction
- **AND** the media part bytes are byte-identical afterwards

#### Scenario: Float drag commit

- **WHEN** an anchored drawing commit is called with a resolved position offset against its declared `ST_RelFromH` / `ST_RelFromV` frames
- **THEN** `wp:posOffset` (or `wp:simplePos` when `@simplePos="1"`) updates in one store transaction
- **AND** the anchor frames themselves are preserved unless the user explicitly changes wrap mode

#### Scenario: Inline drag commit

- **WHEN** an inline drawing is converted to a floating wrap mode or repositioned through an explicit wrap change
- **THEN** `wp:inline` becomes `wp:anchor` (or the reverse for inline conversion) in one transaction
- **AND** the drawing remains one atomic model unit throughout

### Requirement: One user image action commits atomically

Insert, replace, delete, resize, crop, alt-text, wrap, and position operations SHALL update the canonical drawing subtree, owner relationships, content types, and media parts in one validated undo unit. Any validation failure rolls back the whole intent and returns a typed reason; the package is unchanged.

#### Scenario: Insert is one undo unit

- **WHEN** insert-image runs with validated bytes
- **THEN** the media part, its `[Content_Types].xml` override, its relationship, the drawing subtree, and a non-zero `wp:docPr/@id` are added in one transaction and one history entry

#### Scenario: Replace is one undo unit

- **WHEN** replace-image runs with validated bytes
- **THEN** the drawing reference switches atomically and the old media part is collected only after a package-wide live-reference check shows it is orphaned

#### Scenario: Delete is one undo unit

- **WHEN** delete-image runs on the last drawing referencing a media part
- **THEN** the drawing node, its relationship, its content-type entry, and the media part are removed in one transaction and one history entry

#### Scenario: Undo restores the prior package state

- **WHEN** the user undoes an insert, replace, or delete
- **THEN** every part, relationship, content-type entry, and drawing node returns to the pre-action state in one history step

#### Scenario: Redo replays the committed intent

- **WHEN** the user redoes an image action immediately after undoing that same committed insert, replace, or delete
- **THEN** the same package mutation commits again as one history step

### Requirement: Drawing identifiers are allocated deterministically and package-wide

New `wp:docPr/@id` values SHALL be non-zero `xsd:unsignedInt`, unique across every canonical part in the package, allocated above the highest valid existing id, and never derived from a clock, timestamp, random source, or hash. Exhaustion of the unsigned 32-bit range SHALL return `invalidArgs`. Existing duplicate or zero ids on load are preserved on an unedited round trip but are never allocated by the engine.

#### Scenario: Seeded from the package maximum

- **WHEN** an image is inserted into a document whose highest valid `wp:docPr/@id` is 11
- **THEN** the allocated id is 12

#### Scenario: Never zero

- **WHEN** a drawing id is allocated
- **THEN** it is greater than zero

#### Scenario: Exhaustion is refused

- **WHEN** no unused non-zero id remains in range
- **THEN** insert-image returns `invalidArgs` and writes nothing

### Requirement: Media cleanup happens only when unreferenced

Delete and replace SHALL remove an orphaned relationship, content-type entry, and media part only after a package-wide live-reference check confirms no relationship still names the part. Shared media remains when any drawing still references it.

#### Scenario: Shared part survives partial delete

- **WHEN** one of three drawings referencing the same `r:embed` is deleted
- **THEN** the media part, its override, and its relationship remain

#### Scenario: Last reference collects the part

- **WHEN** the last drawing referencing a media part is deleted or replaced away from that part
- **THEN** the orphaned part, override, and relationship are removed in the same transaction

#### Scenario: Replace collects only after the swap

- **WHEN** replace-image swaps to new validated bytes
- **THEN** the old part is collected only if no remaining relationship references it after the swap commits
