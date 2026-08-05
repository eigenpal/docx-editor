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

**Nested lock union.** Effective permissions are the union of the control's own lock and every ancestor control's lock, evaluated on two axes: content edit is forbidden when any ancestor or self declares `contentLocked` or `sdtContentLocked`; removal is forbidden when any ancestor or self declares `sdtLocked` or `sdtContentLocked`. The strictest ancestor on each axis wins.

The shipped `ContentControlSummary.locked?: boolean` reports only the content-edit axis: `true` when the nested union forbids editing content; absent or `false` when editing is allowed. It does not encode removal-only `sdtLocked`.

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

#### Scenario: An inner control inherits an ancestor content lock

- **WHEN** an outer control declares `contentLocked` and an inner control declares `unlocked`
- **THEN** editing the inner control's content is refused with `locked`

#### Scenario: An inner control inherits an ancestor removal lock

- **WHEN** an outer control declares `sdtLocked` and an inner control declares `unlocked`
- **THEN** removing the inner control is refused with `locked`
- **AND** editing the inner control's content is allowed

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

Naming a control on an insertion decides where the text is written AND what the refusals are resolved against, so the name SHALL be validated before either. The name SHALL resolve to a typed content control in the addressed part; a node of any other kind — including a `w:sdt` the read demoted — SHALL be refused with `not-a-content-control`. The control SHALL lie on the same ancestor line as the addressed paragraph, holding it or held by it, and a control elsewhere in the document SHALL be refused with `unknown-content-control`. The addressed offset SHALL fall within the span the control covers in the addressed paragraph — its own offsets for an inline control, the whole paragraph for a block control that holds it — and an offset outside that span SHALL be refused with `offset-out-of-range`, by one rule for both kinds. A reach addressed at a control that cannot be resolved to one SHALL be treated as reaching the whole part, so a forged name is refused by forms protection even where it is resolved before validation runs.

#### Scenario: A name that is not a control

- **WHEN** an insertion names the addressed paragraph, a run, or a demoted `w:sdt` as its owner
- **THEN** it is refused, and in a form-protected document it is refused as protected content rather than exempted as a field

#### Scenario: A control somewhere else in the document

- **WHEN** an insertion in one paragraph names a control held by another
- **THEN** it is refused with `unknown-content-control` and neither paragraph is changed

### Requirement: A value write is resolved against the controls it lands in, not only the one it names

A write addressed AT a control at a POSITION SHALL be resolved against every control between the part root and the place the content would actually go: the named control, the controls enclosing it, and any control nested inside it that the write would land in. The landing place SHALL be resolved by the same rule the applier writes by — the text value the offset falls inside, otherwise the run the offset starts, otherwise the last run the named control owns in that paragraph, otherwise the node a run would be MINTED in — so a refusal and a write never reason about two different places.

A write with no run to join SHALL be resolved against the node that receives the minted run: the addressed paragraph when the named control holds that paragraph, and the named control's own content when the control sits inline within it. An empty or otherwise run-less paragraph is therefore not "nowhere" — a control holding it receives the minted run and its lock or `w:dataBinding` SHALL answer, and an inline owner's own content receives the run beside anything nested there rather than inside it.

This SHALL hold for a block control and an inline control alike, at any nesting depth the shared bound admits, and both halves of the resolution SHALL stop at that same bound: a run one bounded walk can reach and another cannot is a run a write can land in at an offset nobody can address.

#### Scenario: A locked control nested in the one an insertion names

- **WHEN** a script inserts text at the start or the end of an unlocked, unbound control whose content begins or ends with a `sdtContentLocked` control
- **THEN** it is refused with `locked`, and the nested control holds exactly what the file wrote

#### Scenario: A bound control nested in the one an insertion names

- **WHEN** the same insertion would land in a nested control declaring `w:dataBinding`
- **THEN** it is refused with `bound`, for block and inline nesting alike

#### Scenario: A nested control holding an empty paragraph

- **WHEN** a script inserts text at the start or the end of an unlocked, unbound control whose content is, or ends with, a locked or bound control holding an empty or blank paragraph
- **THEN** it is refused with `locked` or `bound`, because the run the write mints lands in that paragraph, and the saved file holds no part of the write

#### Scenario: A write into the named control's own content

- **WHEN** the insertion lands in the named control's own characters rather than in anything nested there
- **THEN** it is allowed, and a nested locked or bound control elsewhere in that control does not refuse it

#### Scenario: An inline control with nothing to join

- **WHEN** an insertion names an inline control that holds no run of its own, and the control's content begins with a locked nested control
- **THEN** it is allowed, because the minted run becomes the named control's own content beside the nested one rather than inside it

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

A control declaring `w:dataBinding` names a custom XML part this engine preserves without evaluating. Every content mutation targeting or intersecting such a control SHALL be refused with `bound` — ordinary typing, deletion, formatting, structural splits, tracked-change decisions and an insertion that names the control as its owner, not only a value write — so the document's two answers cannot diverge. The refusal SHALL be resolved in validation for every one of those paths rather than delegated to the applier of any single operation. Removing the control THE CALLER NAMED SHALL be allowed: it removes the claim that the content mirrors a part, leaving both sides as the file wrote them. A lock SHALL still refuse the removal on its own terms.

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

- **WHEN** a bound control is removed BY NAME, with or without its content
- **THEN** the removal is allowed and the binding leaves with the wrapper

### Requirement: A write that replaces a control's whole content is resolved against everything in it

Setting a control's value rebuilds its `w:sdtContent` from nothing, and removing a control without keeping its content deletes that content outright. Either operation SHALL be resolved against every control nested inside the named one, not only the named control and its ancestors: a control the caller never mentioned is otherwise deleted — its `ST_Lock`, its `w:dataBinding` and its text together — by an operation that asked permission only of the control that was already decided about.

A nested control whose resolved lock forbids editing its content, or forbids removing the control, SHALL refuse the operation with `locked`. A nested control declaring `w:dataBinding` SHALL refuse it with `bound`, because a projection of a custom XML part is being discarded as the collateral of an operation about something else rather than by the decision to delete it; a caller that means to drop a bound field SHALL still be able to name it and remove it.

The nested controls' own resolved locks SHALL decide this, WITHOUT re-applying the named control's chain: whether the named control permits the operation at all is a question its own lock has already answered, and asking it twice would make an enclosing `sdtLocked` — which forbids deleting that control and expressly permits editing its content — refuse a value write merely because something unlocked was nested in it.

A removal that KEEPS the content SHALL reach none of them. The nested controls survive the operation intact, spliced into the parent exactly as they were, so nothing nested has anything to refuse; refusing it would make a wrapper around a locked or bound field permanent. Writing a control's tag or alias SHALL likewise reach nothing nested. The descent SHALL carry the same nesting and element bounds as every other file-driven walk.

#### Scenario: A locked control inside the one whose value is set

- **WHEN** a script sets the value of an unlocked control whose content holds a locked control, inline or block, at any depth the bound admits
- **THEN** it is refused with `locked` and the saved part is byte-for-byte what it was

#### Scenario: A nested control that may not itself be deleted

- **WHEN** the nested control declares `sdtLocked`, which permits editing its content and forbids removing it
- **THEN** the replacement is refused with `locked`, because the replacement removes it

#### Scenario: A bound control inside the one whose value is set

- **WHEN** the nested control declares `w:dataBinding`
- **THEN** it is refused with `bound` through both the value command and the insert-text command's replace location

#### Scenario: A removal that takes the content with it

- **WHEN** a control is removed without keeping its content, and that content holds a locked or bound control
- **THEN** it is refused with `locked` or `bound` and nothing is removed

#### Scenario: A removal that keeps the content

- **WHEN** the same control is removed while keeping its content
- **THEN** it is allowed, the wrapper goes, and the nested locked or bound control is spliced into the parent unchanged

#### Scenario: Nothing protected is nested there

- **WHEN** the named control holds no nested control, or holds only unlocked and unbound ones
- **THEN** the value write replaces the content exactly as it did before

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

A control with `w:showingPlcHdr` SHALL render its content as placeholder: visually distinguished via `w:sdtPr/w:rPr`, and replaced wholesale on first input rather than appended to. First input SHALL clear `w:showingPlcHdr`. For literal-only placeholders, there is no durable prompt source after replacement; emptying content later SHALL leave the control empty and SHALL NOT reassert `w:showingPlcHdr`. Undo through D10 history MAY restore the prior placeholder state.

#### Scenario: Placeholder styling comes from sdtPr rPr

- **WHEN** a control sets `w:showingPlcHdr` and declares `w:sdtPr/w:rPr`
- **THEN** paint applies that `rPr` to the placeholder display
- **AND** authored `w:rPr` on runs inside `w:sdtContent` is not the placeholder style source

#### Scenario: Typing replaces the prompt

- **WHEN** the user places the caret in a control showing placeholder text and types
- **THEN** the entire placeholder content is replaced by the typed text in one transaction
- **AND** `w:showingPlcHdr` is cleared in the same transaction

#### Scenario: Emptying after replace does not restore the prompt

- **WHEN** the user replaces a literal-only placeholder and later deletes all content from the control
- **THEN** the control remains empty
- **AND** `w:showingPlcHdr` is not reasserted

#### Scenario: Undo may restore placeholder state

- **WHEN** the user replaces a literal-only placeholder and then undoes that edit through history
- **THEN** the prior placeholder content and `w:showingPlcHdr` state are restored from the undo stack

#### Scenario: Placeholder is not selectable as ordinary text

- **WHEN** the user drags a selection through a control showing placeholder text
- **THEN** the control is selected as a unit rather than a partial range of prompt characters being selected

#### Scenario: Literal prompt with no glossary reference

- **WHEN** a control sets `w:showingPlcHdr` with no `w:placeholder/w:docPart`, as all twelve such controls in the comprehensive fixture do
- **THEN** the literal content inside `w:sdtContent` is the placeholder

#### Scenario: Glossary-referenced placeholder is preserved, not resolved

- **WHEN** a control declares `w:placeholder/w:docPart`
- **THEN** the reference is preserved on round trip
- **AND** the glossary part is not read in this change
- **AND** replacing and emptying content does not invent a restore from the glossary reference

#### Scenario: Saved file does not lie about placeholder state

- **WHEN** a user replaces a prompt with real content and saves
- **THEN** `w:showingPlcHdr` is absent from that control in the output

### Requirement: Temporary controls self-remove on first successful content edit

When `w:sdtPr/w:temporary` is present, the control SHALL unwrap — remove the wrapper while keeping its content at the same position — in the same transaction as the first successful content edit. Clearing content back to empty after that edit does not restore the wrapper.

#### Scenario: First edit unwraps a temporary control

- **WHEN** the user commits the first successful content edit inside a control declaring `w:temporary`
- **THEN** the wrapper is removed and the content remains in place
- **AND** the published `ModelChange` carries an impact class no narrower than `flow-structural`

#### Scenario: Temporary is independent of placeholder

- **WHEN** a control declares `w:temporary` without `w:showingPlcHdr` and receives its first successful content edit
- **THEN** the wrapper is removed in the same transaction
