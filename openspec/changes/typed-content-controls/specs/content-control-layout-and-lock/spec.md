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

### Requirement: Every mutating operation meets the lock, and an unclassified one fails closed

Lock and forms-protection enforcement SHALL be resolved from what an operation would CHANGE, not from a list of operation names. Each `TreeDocOp` kind SHALL declare its reach — the nodes, character ranges, tracked changes, or the whole part — exhaustively over the operation union, so an operation added without a declared reach does not compile. An operation whose reach cannot be resolved SHALL be treated as reaching the whole part and refused wherever protected or locked content would change. Read and part-lifecycle operations SHALL NOT be treated as content mutations.

#### Scenario: A tracked-change decision inside a locked control

- **WHEN** accepting or rejecting a revision whose markup sits inside a control forbidding content edits
- **THEN** it is refused with `locked`

#### Scenario: A hyperlink write resolves its owner

- **WHEN** retargeting or unlinking a hyperlink that sits inside a control forbidding content edits
- **THEN** it is refused with `locked`, because the link's owning control is resolved from the link node

#### Scenario: A document-wide operation under protection

- **WHEN** a document-scoped write (page setup, note settings, accept-all) would change content that a lock or forms protection protects
- **THEN** it is refused with `locked`

#### Scenario: Furniture lifecycle is not a content mutation

- **WHEN** a header or footer is created, deleted or relinked in a document that holds a locked control
- **THEN** the operation is not refused on account of that lock

### Requirement: A bound control refuses every content mutation, and removal takes the binding with it

A control declaring `w:dataBinding` names a custom XML part this engine preserves without evaluating. Every content mutation targeting or intersecting such a control SHALL be refused with `bound` — ordinary typing, deletion, formatting, structural splits and tracked-change decisions, not only a value write — so the document's two answers cannot diverge. Removing the control SHALL be allowed: it removes the claim that the content mirrors a part, leaving both sides as the file wrote them. A lock SHALL still refuse the removal on its own terms.

#### Scenario: Typing inside a bound control

- **WHEN** text is inserted, deleted or formatted inside a control declaring `w:dataBinding`
- **THEN** it is refused with `bound` and the file is unchanged

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
