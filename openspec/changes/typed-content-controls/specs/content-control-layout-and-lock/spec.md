## ADDED Requirements

### Requirement: Flattening stays the layout rule, and extends to inline controls

Block-level control content SHALL continue to join the flow in reading order, because that is what Word renders. Inline control content SHALL likewise contribute its runs to the containing paragraph. A control SHALL NOT become a layout container, a fragment boundary, or a line-breaking obstacle.

#### Scenario: Block control flows in place

- **WHEN** a `w:sdt` wraps a paragraph in the body
- **THEN** the paragraph flows exactly as it would without the wrapper, with the same line breaks

#### Scenario: Inline control flows in place

- **WHEN** an inline control wraps runs mid-paragraph
- **THEN** those runs join the paragraph's line breaking with no added break opportunity at the control's boundary

#### Scenario: Control in a table cell flows in place

- **WHEN** a control wraps a paragraph inside `w:tc`
- **THEN** the cell measures and flows as it would without the wrapper

#### Scenario: Removing a wrapper changes no geometry

- **WHEN** a control is removed while its content is kept
- **THEN** the resulting page geometry is identical to the geometry before removal

### Requirement: Nesting is bounded at block and inline level

The existing block-level nesting bound SHALL be retained and applied to the inline path. Beyond the bound, content SHALL be preserved and flattening SHALL stop rather than recursing.

#### Scenario: Deeply nested controls do not exhaust the stack

- **WHEN** a document nests controls beyond the bound
- **THEN** loading and layout complete, the content beyond the bound is preserved in the tree, and no unbounded recursion occurs

#### Scenario: Bound is shared

- **WHEN** the nesting bound is reached through a mix of block and inline wrappers
- **THEN** the same bound applies, not a separate budget per level kind

### Requirement: Layout emits a boundary record per control

Layout SHALL emit, for each control, a record carrying its identity, tag, alias, type, resolved lock state, placeholder state, and the geometry of its content. Chrome and lock enforcement SHALL read this record rather than inspecting painted DOM.

#### Scenario: Boundary is available to the surface

- **WHEN** a page containing a dropdown control is laid out
- **THEN** a boundary record for that control is published with its type and the rectangle covering its content

#### Scenario: Boundary spans a page break

- **WHEN** a block control's content splits across two pages
- **THEN** the boundary record reports both fragments' geometry rather than one rectangle covering the gap

#### Scenario: Boundary is not a hit-test authority of its own

- **WHEN** a pointer event lands inside a control
- **THEN** the position resolves through the same semantic hit test used elsewhere, with the boundary record identifying which control was hit

### Requirement: Locks are enforced at the store, not at the surface

`w:sdtPr/w:lock` SHALL be enforced during `TreeDocOp` validation, so a keystroke, a command, and an agent are refused identically. `sdtLocked` forbids removing the control; `contentLocked` forbids editing its content; `sdtContentLocked` forbids both; `unlocked` and an absent lock forbid neither. A refused operation SHALL return `locked` and publish no `ModelChange`.

#### Scenario: contentLocked refuses a text edit

- **WHEN** a text insertion targets a range inside a control declaring `contentLocked`
- **THEN** it is refused with `locked` and the tree is unchanged

#### Scenario: sdtLocked refuses removal but allows editing

- **WHEN** a control declares `sdtLocked`
- **THEN** removing the control is refused with `locked`
- **AND** editing its content is allowed

#### Scenario: sdtContentLocked refuses both

- **WHEN** a control declares `sdtContentLocked`
- **THEN** both editing its content and removing it are refused with `locked`

#### Scenario: Enforcement is not a UI concern

- **WHEN** a locked control's content is targeted by an agent command that never touches the surface
- **THEN** it is refused identically, because validation happens in the store

#### Scenario: A range spanning a lock boundary

- **WHEN** a delete spans from unlocked text into a `contentLocked` control
- **THEN** the whole operation is refused rather than partially applied

#### Scenario: An inline control's own characters are locked

- **WHEN** an insertion, a deletion or a run-property write addresses offsets that fall inside an inline control declaring `sdtContentLocked`
- **THEN** it is refused with `locked`, even though the paragraph named by the operation is outside the control
- **AND** the same operation addressing offsets beside the control is allowed

### Requirement: A control's leading edge belongs to the control and its trailing edge does not

An offset at a boundary is owned by the run that STARTS there, which is what an insertion applied at that offset actually does. Validation SHALL resolve a control's reach the same way: a point operation that WRITES content at a control's leading edge SHALL be treated as reaching inside the control, and the same operation at its trailing edge SHALL NOT. A point operation that writes no content into the run it names — a comment marker, a paragraph split — SHALL be treated as beside the control at either edge. A caller that must write into a control regardless of what sits at the offset SHALL name that control on the operation, and the write SHALL then land in the control's own runs.

#### Scenario: Typing at a locked field's leading edge

- **WHEN** text, a tab or a break is inserted at the offset where a `sdtContentLocked` inline control begins
- **THEN** it is refused with `locked`, because that is where the content would be written

#### Scenario: Typing at a locked field's trailing edge

- **WHEN** text is inserted at the offset where the same control ends
- **THEN** it is allowed, and the control's content is unchanged

#### Scenario: A caller that names the control it writes into

- **WHEN** an insertion names a content control as the owner of the text
- **THEN** the text is written into that control's own runs at either edge, keeping the formatting of the run it joins
- **AND** the control's lock and `w:dataBinding` are resolved against that control

### Requirement: A named owner is validated before anything is resolved against it

Naming a control on an insertion decides where the text is written AND what the refusals are resolved against, so the name SHALL be validated before either. The name SHALL resolve to a typed content control in the addressed part; a node of any other kind — including a `w:sdt` the read demoted — SHALL be refused with `not-a-content-control`. The control SHALL lie on the same ancestor line as the addressed paragraph, holding it or held by it, and a control elsewhere in the document SHALL be refused with `unknown-content-control`. The addressed offset SHALL fall within the control's own span, and one outside it SHALL be refused with `offset-out-of-range`. A reach addressed at a control that cannot be resolved to one SHALL be treated as reaching the whole part, so a forged name is refused by forms protection even where it is resolved before validation runs.

#### Scenario: A name that is not a control

- **WHEN** an insertion names the addressed paragraph, a run, or a demoted `w:sdt` as its owner
- **THEN** it is refused, and in a form-protected document it is refused as protected content rather than exempted as a field

#### Scenario: A control somewhere else in the document

- **WHEN** an insertion in one paragraph names a control held by another
- **THEN** it is refused with `unknown-content-control` and neither paragraph is changed

### Requirement: Every mutating operation meets the lock, and an unclassified one fails closed

Lock and forms-protection enforcement SHALL be resolved from what an operation would CHANGE, not from a list of operation names. Each `TreeDocOp` kind SHALL declare its reach — the nodes, character ranges, tracked changes, the document's own properties, or the whole part — exhaustively over the operation union, so an operation added without a declared reach does not compile. An operation whose reach cannot be resolved SHALL be treated as reaching the whole part and refused wherever protected or locked content would change. Read and part-lifecycle operations SHALL NOT be treated as content mutations.

A `w:lock` protects a control and the characters it holds, and SHALL NOT refuse a change to the DOCUMENT's own properties — page setup, section furniture options, note numbering — which are neither. Forms protection SHALL still refuse those, because a protected document is read-only except for filling in fields.

#### Scenario: A tracked-change decision inside a locked control

- **WHEN** accepting or rejecting a revision whose markup sits inside a control forbidding content edits
- **THEN** it is refused with `locked`

#### Scenario: A hyperlink write resolves its owner

- **WHEN** retargeting or unlinking a hyperlink that sits inside a control forbidding content edits
- **THEN** it is refused with `locked`, because the link's owning control is resolved from the link node

#### Scenario: A document-wide content rewrite under a lock

- **WHEN** an operation that could rewrite content anywhere (accept-all, deleting or converting a note) runs in a document holding a control that forbids content edits
- **THEN** it is refused with `locked`, because nothing narrows where it lands

#### Scenario: Page setup beside a locked field

- **WHEN** page setup, section furniture options or note numbering are written in a document holding a `contentLocked` control
- **THEN** the operation is not refused on account of that lock
- **AND** the same operation IS refused with `locked` while forms protection is enforced

#### Scenario: Furniture lifecycle is not a content mutation

- **WHEN** a header or footer is created, deleted or relinked in a document that holds a locked control
- **THEN** the operation is not refused on account of that lock

### Requirement: Forms protection exempts what an operation addresses, not the node it names

Under `w:documentProtection @w:edit="forms"` the document is read-only EXCEPT inside content controls. The exemption SHALL be resolved from the character range or point an operation addresses, using the same edge rule locks use, rather than from whether the named node sits inside a control — an inline field's paragraph is outside the field, so resolving from the named node alone would refuse every write into every inline form field in every protected document. A range that leaves the control it starts in SHALL NOT be exempt, and an operation addressing a whole node rather than a range SHALL NOT be exempt. A control's own `w:lock` SHALL still refuse independently.

#### Scenario: Filling in an inline field

- **WHEN** text is inserted at an offset inside — or at the leading edge of — an unlocked inline control in a protected document
- **THEN** it is allowed
- **AND** the same insertion at the control's trailing edge, or beside it, is refused with `locked`

#### Scenario: An edit that leaves the field

- **WHEN** a deletion starts inside an unlocked inline control and ends outside it
- **THEN** it is refused with `locked`

#### Scenario: The paragraph around the field is still protected

- **WHEN** a paragraph-property write names the paragraph that holds an unlocked inline control
- **THEN** it is refused with `locked`, because changing the paragraph is not filling in the field

### Requirement: A bound control refuses every content mutation, and removal takes the binding with it

A control declaring `w:dataBinding` names a custom XML part this engine preserves without evaluating. Every content mutation targeting or intersecting such a control SHALL be refused with `bound` — ordinary typing, deletion, formatting, structural splits, tracked-change decisions and an insertion that names the control as its owner, not only a value write — so the document's two answers cannot diverge. The refusal SHALL be resolved in validation for every one of those paths rather than delegated to the applier of any single operation. Removing the control SHALL be allowed: it removes the claim that the content mirrors a part, leaving both sides as the file wrote them. A lock SHALL still refuse the removal on its own terms.

#### Scenario: Typing inside a bound control

- **WHEN** text is inserted, deleted or formatted inside a control declaring `w:dataBinding`
- **THEN** it is refused with `bound` and the file is unchanged

#### Scenario: The insert-text command on a bound control

- **WHEN** the object model inserts text at the start, the end, or in place of a bound control's value
- **THEN** all three are refused with `bound` and the control still holds what the file wrote

#### Scenario: Metadata is not the bound value

- **WHEN** the tag or alias of a bound control is written
- **THEN** it is allowed and `w:dataBinding` is preserved

#### Scenario: Removing a bound control

- **WHEN** a bound control is removed, with or without its content
- **THEN** the removal is allowed and the binding leaves with the wrapper

### Requirement: Row- and cell-level controls are flattened where a walk filters on rows and cells

`CT_SdtRow` places a control between a table and its row; `CT_SdtCell` between a row and its cell. One bounded unwrap rule SHALL be applied wherever a walk selects rows or cells — table layout's grid and cell passes, list resolution, and story paragraph collection — so a controlled row or cell is measured, painted, addressable, and claims its grid column and `w:gridSpan` exactly as an unwrapped one does.

#### Scenario: A controlled row is a row

- **WHEN** a table holds a row wrapped in `w:sdt`
- **THEN** the row is laid out in document order with the geometry it would have unwrapped
- **AND** its `w:trPr` semantics — header repeat, `w:cantSplit` — are unchanged

#### Scenario: A controlled cell claims its grid

- **WHEN** a row holds a cell wrapped in `w:sdt`, with a `w:gridSpan`
- **THEN** the cell and every cell after it claim the same grid columns they would unwrapped

#### Scenario: A controlled row or cell stays addressable

- **WHEN** paragraphs are collected for a story
- **THEN** the paragraphs inside a controlled row or cell are collected in document order

#### Scenario: The surface reflects the lock before the refusal

- **WHEN** the caret sits inside a `contentLocked` control
- **THEN** editing controls render disabled with the engine's reason, so the user is told before typing rather than after

### Requirement: Placeholder text is a state, not authored content

A control with `w:showingPlcHdr` SHALL render its content as placeholder: visually distinguished, and replaced wholesale on first input rather than appended to. Committing content SHALL clear `w:showingPlcHdr`; clearing content back to empty SHALL restore it.

#### Scenario: Typing replaces the prompt

- **WHEN** the user places the caret in a control showing placeholder text and types
- **THEN** the entire placeholder content is replaced by the typed text in one transaction
- **AND** `w:showingPlcHdr` is cleared in the same transaction

#### Scenario: Emptying restores the prompt

- **WHEN** the user deletes all content from a control that has a placeholder
- **THEN** the placeholder content and `w:showingPlcHdr` are restored

#### Scenario: Placeholder is not selectable as ordinary text

- **WHEN** the user drags a selection through a control showing placeholder text
- **THEN** the control is selected as a unit rather than a partial range of prompt characters being selected

#### Scenario: Literal prompt with no glossary reference

- **WHEN** a control sets `w:showingPlcHdr` with no `w:placeholder/w:docPart`, as all twelve such controls in the comprehensive fixture do
- **THEN** the literal content inside `w:sdtContent` is the placeholder

#### Scenario: Glossary-referenced placeholder is preserved, not resolved

- **WHEN** a control declares `w:placeholder/w:docPart`
- **THEN** the reference is preserved on round trip
- **AND** the glossary part is not read in this change; the control's own content is what renders

#### Scenario: Saved file does not lie about placeholder state

- **WHEN** a user replaces a prompt with real content and saves
- **THEN** `w:showingPlcHdr` is absent from that control in the output
