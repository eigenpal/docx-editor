## ADDED Requirements

### Requirement: The revision family is typed with required provenance

The canonical tree SHALL type `w:ins`, `w:del`, `w:delText`, `w:moveFrom`, `w:moveTo`, the four move-range markers, the property-change wrappers (`w:rPrChange`, `w:pPrChange`, `w:tblPrChange`, `w:tcPrChange`, `w:trPrChange`, `w:sectPrChange`, `w:tblGridChange`), and the cell-revision elements (`w:cellIns`, `w:cellDel`, `w:cellMerge`). Every one extends `CT_TrackChange`, so `@w:id` and `@w:author` are required and `@w:date` is optional.

#### Scenario: Insertion types with its provenance

- **WHEN** a `w:ins` wrapping runs is loaded
- **THEN** it is a typed revision node carrying its id, author, and date

#### Scenario: Author is required at the API

- **WHEN** an operation creates a revision without an author
- **THEN** it is refused with `invalidArgs` and no `ModelChange` is published

#### Scenario: Missing date is tolerated

- **WHEN** a `w:ins` declares no `@w:date`
- **THEN** it loads, and saving does not fabricate a date

#### Scenario: Cell merge revision types

- **WHEN** a `w:cellMerge` carries `@w:vMerge` and `@w:vMergeOrig`
- **THEN** both are typed and round-trip

#### Scenario: Unmodelled revision markup stays generic

- **WHEN** a revision element outside this vocabulary appears
- **THEN** it is preserved in order as a generic node and does not block editing

### Requirement: Revision ids are unique within a part, never across the package

A revision SHALL be addressed by the pair (part, id). Two revisions in different parts MAY share an id.

#### Scenario: Same id in body and footnote part

- **WHEN** the body and a footnote part each contain a revision with `w:id="4"`
- **THEN** both are separately addressable and neither shadows the other

#### Scenario: Accept addresses a part

- **WHEN** accept-revision is called with an id but no part
- **THEN** it is refused with `invalidArgs` rather than resolving to whichever part is found first

#### Scenario: Allocation does not reuse a live id

- **WHEN** a revision is created in a part
- **THEN** its id does not collide with any live revision id in that part
- **AND** allocation is monotonic within an editor instance, so an id freed by a deletion is not immediately reissued

### Requirement: Deleted text is never laid out as ordinary text

`w:delText` SHALL NOT flow as ordinary content. Its presentation SHALL be determined by the active display mode, and it SHALL be excluded from the ordinary caret space so a user cannot type inside deleted content as if it were live.

#### Scenario: Deleted text is visibly deleted

- **WHEN** a document containing `w:del` is laid out in all-markup mode
- **THEN** the deleted text renders struck through and visually marked as a deletion

#### Scenario: Deleted text is absent from the proposed result

- **WHEN** the display mode is the proposed result
- **THEN** the deleted text is not laid out at all

#### Scenario: Caret does not enter deleted content

- **WHEN** the caret moves across a deletion with an arrow key
- **THEN** it steps over the deletion rather than landing inside it, in every display mode

#### Scenario: Insertions render as insertions

- **WHEN** a document containing `w:ins` is laid out in all-markup mode
- **THEN** the inserted text is visually marked as an insertion, distinguishable from ordinary text

#### Scenario: Moves are distinguishable from a delete/insert pair

- **WHEN** a document contains a `w:moveFrom` / `w:moveTo` pair
- **THEN** both render marked as a move, not as an unrelated deletion and insertion

#### Scenario: Property changes render as an indicator

- **WHEN** a paragraph carries `w:pPrChange`
- **THEN** a change indicator is presented for that paragraph
- **AND** no inline text is added to the flow to represent it

### Requirement: Display mode selects what layout produces and mutates nothing

The display mode SHALL be one of all-markup, proposed result, or original. Changing it SHALL re-run layout and SHALL NOT apply a `TreeDocOp` or publish a `ModelChange`.

#### Scenario: Proposed result equals accept-all output

- **WHEN** a document is laid out in proposed-result mode
- **THEN** the resulting pages equal a layout of the same document after accept-all

#### Scenario: Original equals reject-all output

- **WHEN** a document is laid out in original mode
- **THEN** the resulting pages equal a layout of the same document after reject-all

#### Scenario: Switching modes does not dirty the document

- **WHEN** the user switches display mode and then saves
- **THEN** the saved package matches the input by canonical fingerprint

### Requirement: Accept and reject have defined semantics per revision kind

`TreeDocOp` SHALL include accept-revision, reject-revision, accept-all, and reject-all, addressed by (part, id) or by a range. Each SHALL commit atomically.

#### Scenario: Accept an insertion

- **WHEN** an insertion is accepted
- **THEN** its wrapper is removed and its content remains as ordinary content

#### Scenario: Reject an insertion

- **WHEN** an insertion is rejected
- **THEN** its wrapper and its content are both removed

#### Scenario: Accept a deletion

- **WHEN** a deletion is accepted
- **THEN** its wrapper and its content are both removed

#### Scenario: Reject a deletion

- **WHEN** a deletion is rejected
- **THEN** its wrapper is removed, its `w:delText` becomes `w:t`, and the content returns to ordinary flow

#### Scenario: Accept a property change

- **WHEN** a `w:rPrChange` or `w:pPrChange` is accepted
- **THEN** the current properties are kept and the change wrapper carrying the previous properties is removed

#### Scenario: Reject a property change

- **WHEN** a property change is rejected
- **THEN** the properties recorded inside the change wrapper are restored and the wrapper is removed

#### Scenario: A move is accepted or rejected as a pair

- **WHEN** accept-revision targets one half of a `w:moveFrom` / `w:moveTo` pair
- **THEN** both halves resolve in the same transaction
- **AND** accepting the `moveTo` alone, which would duplicate the content, is not reachable

#### Scenario: Orphaned move half

- **WHEN** a document contains a `w:moveTo` with no matching `w:moveFrom`
- **THEN** it loads, is reported as an orphaned move by a diagnostic, and is treated as an insertion for accept/reject

#### Scenario: Nested revisions resolve in a declared order

- **WHEN** an insertion by one author sits inside a deletion by another and the outer deletion is accepted
- **THEN** the resolution follows the specified order — inner first, then outer — and produces the same result regardless of traversal direction

#### Scenario: Accept-all is one history entry

- **WHEN** accept-all runs on a document with forty revisions
- **THEN** it commits in one transaction, publishes one `ModelChange`, and one undo restores every revision

### Requirement: Suggesting mode is a store-level mode

When suggesting mode is active, every accepted user intent SHALL commit as a tracked revision carrying the configured author. The mode SHALL apply to operations that never touch the surface, including agent commands.

#### Scenario: Typing produces an insertion

- **WHEN** the user types in suggesting mode
- **THEN** the committed tree carries a `w:ins` with the configured author, not an untracked run

#### Scenario: Deleting produces a deletion

- **WHEN** the user deletes live text in suggesting mode
- **THEN** the text becomes `w:delText` inside a `w:del`, and is not removed

#### Scenario: Deleting one's own pending insertion removes it

- **WHEN** the user deletes text they inserted in the same suggesting session
- **THEN** the insertion is removed rather than wrapped in a deletion

#### Scenario: Formatting produces a property change

- **WHEN** the user applies bold in suggesting mode
- **THEN** a `w:rPrChange` records the previous run properties

#### Scenario: Mode requires an author

- **WHEN** suggesting mode is enabled with no author configured
- **THEN** enabling it is refused with `invalidArgs`, because provenance is required by the schema

#### Scenario: Agent commands are tracked too

- **WHEN** an agent command edits text while suggesting mode is active
- **THEN** the result is tracked with the configured author, because the mode lives in the store

### Requirement: Revision markup satisfies both D9 oracles

Parts containing revisions SHALL pass the canonical tree fingerprint on an unedited round trip and the save/reopen semantic digest after an accept or reject.

#### Scenario: Untouched revisions survive an unrelated edit

- **WHEN** a tracked document is loaded, an unrelated untracked paragraph is edited, and the package is saved
- **THEN** every revision subtree matches its input by canonical fingerprint

#### Scenario: Accept reopens equivalent

- **WHEN** one revision is accepted, saved, and reopened
- **THEN** the digest reports the accepted content present, that revision absent, and every other revision's id, author, date, and content unchanged
