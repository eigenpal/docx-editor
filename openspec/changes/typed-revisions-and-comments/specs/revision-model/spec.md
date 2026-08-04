## ADDED Requirements

### Requirement: ECMA-376 Part 1 governs the revision markup

Every rule below SHALL be read against ECMA-376 Part 1 as the governing authority: `CT_TrackChange` and the revision elements of §17.13.5, `CT_Markup/@w:id` as `ST_DecimalNumber`, and `w:delText`/`w:delInstrText` as defined there. Where a producer's behaviour is narrower than the schema — a bound on `@w:id`, a date it omits — that SHALL be recorded as an observation about real files and SHALL NOT be presented as a schema requirement. Markup outside Part 1 SHALL be treated as optional evidence whose absence is never an error.

#### Scenario: A schema-valid file is never refused for a producer convention

- **WHEN** a file is valid against Part 1 but does not follow a convention this engine observed elsewhere
- **THEN** it loads and edits, and the convention informs only what this engine WRITES

### Requirement: The revision family is typed with required provenance

The canonical tree SHALL type `w:ins`, `w:del`, `w:delText`, `w:delInstrText`, `w:moveFrom`, `w:moveTo`, the four move-range markers, the property-change wrappers (`w:rPrChange`, `w:pPrChange`, `w:tblPrChange`, `w:tblPrExChange`, `w:tcPrChange`, `w:trPrChange`, `w:sectPrChange`, `w:tblGridChange`), and the cell-revision elements (`w:cellIns`, `w:cellDel`, `w:cellMerge`).

These do **not** share one base type, and typing them as if they did is wrong in both directions — it refuses valid files and emits invalid XML:

| Elements | Base type | Required | Absent from the type |
| --- | --- | --- | --- |
| `w:ins`, `w:del`, `w:moveFrom`, `w:moveTo`, the property-change wrappers, the cell-revision elements | `CT_TrackChange` | `@w:id`, `@w:author` | — (`@w:date` is optional) |
| `w:moveFromRangeStart`, `w:moveToRangeStart` | `CT_MoveBookmark` | `@w:name`, `@w:author`, `@w:date` | — (`@w:colFirst`, `@w:colLast` optional) |
| `w:moveFromRangeEnd`, `w:moveToRangeEnd` | `CT_MarkupRange` | `@w:id` | `@w:author`, `@w:date` |

#### Scenario: Insertion types with its provenance

- **WHEN** a `w:ins` wrapping runs is loaded
- **THEN** it is a typed revision node carrying its id, author, and date

#### Scenario: A move range end carries no provenance

- **WHEN** a `w:moveFromRangeEnd` or `w:moveToRangeEnd` is loaded
- **THEN** it types with its `@w:id` alone
- **AND** loading is not refused for the absent author and date, and neither is written on save

#### Scenario: The two move join keys are distinct

- **WHEN** a document pairs move halves
- **THEN** a `moveFrom` range is paired to its `moveTo` range by `@w:name`
- **AND** a range start is paired to its range end by `@w:id`
- **AND** neither key is used for the other join, because in a real document the two halves of a named pair carry different ids

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

#### Scenario: Revisions type in every story, not only the body

- **WHEN** a package carries revisions in a header, a footer, a footnote, or an endnote part
- **THEN** each types, lays out, and is addressable in that story
- **AND** a document whose only revision is outside `document.xml` presents that revision rather than reporting none

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

`TreeDocOp` SHALL include accept-revision, reject-revision, accept-all, and reject-all, addressed by the revision's `(id, author, date)` triple within a named part, or by a range. Each SHALL commit atomically, resolving every site that shares the triple in one transaction.

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

#### Scenario: Accept a deleted paragraph mark

- **WHEN** a paragraph carries `w:pPr/w:rPr/w:del` and that revision is accepted
- **THEN** the paragraph mark is removed and the paragraph merges with the one that follows it
- **AND** removing only the `w:del` element, which would leave two paragraphs, is not the applied behaviour

#### Scenario: Reject a deleted paragraph mark

- **WHEN** the same revision is rejected
- **THEN** the `w:del` is removed from `w:pPr/w:rPr` and the two paragraphs stay separate

#### Scenario: Accept an inserted paragraph mark

- **WHEN** a paragraph carries `w:pPr/w:rPr/w:ins` and that revision is accepted
- **THEN** the `w:ins` is removed and the paragraph split it recorded is kept

#### Scenario: Reject an inserted paragraph mark

- **WHEN** the same revision is rejected
- **THEN** the paragraph mark is removed and the paragraph merges with the one that follows it, undoing the split

#### Scenario: A move is accepted or rejected as a pair

- **WHEN** accept-revision targets one half of a `w:moveFrom` / `w:moveTo` pair
- **THEN** both halves resolve in the same transaction
- **AND** accepting the `moveTo` alone, which would duplicate the content, is not reachable

#### Scenario: Orphaned move half

- **WHEN** a document contains a `w:moveTo` with no matching `w:moveFrom`
- **THEN** it loads, is reported as an orphaned move by a diagnostic, and is treated as an insertion for accept/reject

#### Scenario: Nested revisions resolve by containment

- **WHEN** an insertion by one author sits inside a deletion by another and the outer deletion is **accepted**
- **THEN** the content is removed and the inner insertion is removed with it, because the container did not survive

#### Scenario: A surviving container preserves its inner revision

- **WHEN** the outer deletion of the same nesting is **rejected**
- **THEN** the content remains and the inner insertion remains pending, unresolved on its author's behalf

#### Scenario: Containment resolution is traversal-independent

- **WHEN** the same nested revision is resolved by a depth-first and by a breadth-first walk
- **THEN** both produce the same tree, because the rule is stated on containment rather than on visit order

#### Scenario: A revision kind without defined structural semantics is refused

- **WHEN** accept or reject targets a revision kind the engine cannot resolve structurally, such as a row deletion carried by `w:trPr/w:del`
- **THEN** it is refused with `unsupported`, no `ModelChange` is published, and the document is unchanged
- **AND** the markup is never removed on its own, because removing the `w:del` inside `w:trPr` would leave the row present while presenting the deletion as accepted

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

### Requirement: Revision identifiers are allocated safely and addressed by their full identity

A revision identifier SHALL be allocated from the maximum revision id already present in the document, plus one, clamped to signed 32-bit. It SHALL NOT be derived from a clock, a timestamp, a random source, or a hash.

This is a range the schema does not enforce: `CT_Markup/@w:id` is `ST_DecimalNumber`, a restriction of `xsd:integer` with **no bounds**, while Word treats it as a signed 32-bit integer. A schema validator therefore accepts a value Word rejects, and the document opens with a repair prompt.

`@w:id` is **not** unique and **not** author-scoped. Two authors' revisions may legally share an id in one part, and one logical revision deliberately spans many elements sharing a single id — a tracked row insertion is `w:trPr/w:ins` on the row plus `w:cellIns` on each of its cells. A revision SHALL therefore be identified by the triple `(id, author, date)`, and addressed together with the part that contains it. Addressing by `(part, id)` alone SHALL NOT be used: it merges two authors' distinct revisions and cannot express a multi-site revision.

#### Scenario: Seeded from the document, never from a clock

- **WHEN** suggesting mode allocates a revision id in a document whose highest existing revision id is 12
- **THEN** the allocated id is 13
- **AND** an id derived from `Date.now()` — a 13-digit value far outside signed 32-bit — is never written

#### Scenario: Exported ids stay inside signed 32-bit

- **WHEN** a package containing engine-authored revisions is saved
- **THEN** every `w:id` on every revision element is within signed 32-bit range
- **AND** a conformance test asserts the bound directly, because schema validation will not catch a violation

#### Scenario: Round-trip through Word

- **WHEN** a document edited in suggesting mode is saved and opened in Word
- **THEN** it opens without a repair prompt and its revisions are listed in the review pane

#### Scenario: Two authors sharing one id

- **WHEN** one part contains a revision `(id 4, author A)` and another `(id 4, author B)`
- **THEN** both are separately addressable and neither is merged into the other

#### Scenario: One id in two parts is two revisions

- **WHEN** a package carries a property change `w:id="0"` inside a style definition in `styles.xml` and an unrelated revision `w:id="0"` in `document.xml`
- **THEN** they resolve as two distinct revisions, because the address includes the part
- **AND** an address that names no part is refused with `invalidArgs` rather than resolving to whichever part is searched first

#### Scenario: A style-definition revision is not a document revision

- **WHEN** `styles.xml` carries `w:pPrChange` or `w:rPrChange` inside a style definition
- **THEN** it round-trips, and it is not presented on the review surface as a revision to document content, because it changes a style rather than a position in a story

#### Scenario: One revision across many sites

- **WHEN** a tracked row insertion carries `w:trPr/w:ins` on the row and `w:cellIns` on each of its three cells, all sharing one id, author, and date
- **THEN** they resolve as ONE revision, accepted or rejected in one transaction and one undo step
- **AND** the review surface lists them as one entry, not four

#### Scenario: Exhaustion is an error, not an overflow

- **WHEN** the signed 32-bit space has no value left
- **THEN** allocation fails with `invalidArgs` and publishes no `ModelChange`, rather than wrapping or truncating

### Requirement: The revision vocabulary covers the markup Word writes around a revision

Typing the four content wrappers is not enough to round-trip a reviewed document. The canonical tree SHALL additionally cover:

| Markup | Why it cannot be left out |
| --- | --- |
| `w:customXmlInsRangeStart`/`End`, `w:customXmlDelRangeStart`/`End`, `w:customXmlMoveFromRangeStart`/`End`, `w:customXmlMoveToRangeStart`/`End` | `EG_RangeMarkupElements` members that record a revision spanning a custom-XML boundary. Dropping one half leaves a start with no end |
| `w:tblPrExChange` | The table-property-exception change. It sits on a ROW (`w:tblPrEx`), not on the table, so a walker looking only at `w:tblPr` never finds it |
| `CT_ParaRPrChange` (`w:pPr/w:rPr/w:rPrChange`) | The paragraph MARK's own run-property change — the pilcrow's formatting. It is not the run-level `w:rPrChange` and resolving it as one applies the change to the wrong thing |
| `w:numPr/w:ins` | A tracked change to a paragraph's NUMBERING. Its `@w:id` is a revision id and it must not be missed by allocation |
| `w:delInstrText` | A field instruction inside a deletion (§17.16.23). A writer that emits `w:instrText` there produces markup its own reject path exists to undo |

Each SHALL round-trip, SHALL contribute its `@w:id` to revision-id allocation where it carries one, and SHALL be presented on the review surface as part of the decision it belongs to rather than as a decision of its own.

#### Scenario: A custom-XML revision range round-trips whole

- **WHEN** a document carries `w:customXmlDelRangeStart` and its matching end
- **THEN** both survive a save and reopen, paired by `@w:id`
- **AND** neither is presented as a revision card of its own

#### Scenario: A row's property-exception change is found

- **WHEN** a row carries `w:tblPrEx/w:tblPrExChange`
- **THEN** it is listed as a pending decision and its `@w:id` is counted by allocation

#### Scenario: The paragraph mark's own formatting change is distinct

- **WHEN** a paragraph carries `w:pPr/w:rPr/w:rPrChange`
- **THEN** it resolves against the paragraph MARK's run properties
- **AND** it is never resolved as if it were a `w:rPrChange` on a run in that paragraph

#### Scenario: A numbering change carries a revision id

- **WHEN** a paragraph carries `w:pPr/w:numPr/w:ins`
- **THEN** allocation counts its `@w:id`, so a new revision cannot be minted onto it

#### Scenario: An instruction inside a deletion is `w:delInstrText`

- **WHEN** a field's instruction is struck by a tracked deletion
- **THEN** it is written as `w:delInstrText`
- **AND** rejecting the deletion renames it back to `w:instrText`

### Requirement: Document-level tracking settings are read and honoured

`settings.xml` states whether the DOCUMENT asks for tracking. The engine SHALL read `w:trackRevisions` and SHALL enter suggesting mode when a document declares it, rather than presenting a document that asks for tracking as an ordinary editable one. Saving SHALL preserve the setting, and turning suggesting mode on or off SHALL write it, because that is where Word looks.

`w:documentProtection/@w:edit="trackedChanges"` states something stronger: the document permits editing ONLY as tracked changes. The engine SHALL honour it by refusing to leave suggesting mode. It SHALL NOT be treated as a security boundary — the protection is advisory, the password hash in `@w:hash` is not verified, and a file is editable by anyone holding it — but ignoring it silently produces untracked edits in a document whose author asked for the opposite.

`w:doNotTrackMoves` and `w:doNotTrackFormatting` narrow what tracking produces: with the first, a move is written as an ordinary deletion and insertion rather than as a `w:moveFrom`/`w:moveTo` pair; with the second, a formatting change is applied without a `w:rPrChange`. Both SHALL be honoured on WRITE. Neither changes how existing markup is READ: a `w:moveFrom` in a document declaring `w:doNotTrackMoves` is still a move, because the setting governs what a producer emits from now on.

#### Scenario: A document asking for tracking opens in suggesting mode

- **WHEN** a package whose `settings.xml` declares `w:trackRevisions` is opened with an author configured
- **THEN** the editor is in suggesting mode, and the first keystroke commits as a `w:ins`

#### Scenario: Toggling the mode writes the setting

- **WHEN** suggesting mode is turned off and the package is saved
- **THEN** `w:trackRevisions` is absent from `settings.xml`
- **AND** every other setting in that part is unchanged

#### Scenario: A document with no author still reports what it asked for

- **WHEN** a document declaring `w:trackRevisions` is opened with no author configured
- **THEN** suggesting mode is not entered, and the refusal reason is published rather than the request being dropped silently

#### Scenario: Protection restricted to tracked changes cannot be left

- **WHEN** `w:documentProtection/@w:edit="trackedChanges"` is declared and the user selects Editing
- **THEN** the change is refused with `locked` and the mode stays Suggesting

#### Scenario: Protection is not presented as security

- **WHEN** a document declares `w:documentProtection` with a password hash
- **THEN** the hash is neither verified nor presented as one that was, because the file is editable by anyone holding it

#### Scenario: Moves are not tracked when the document says not to

- **WHEN** `w:doNotTrackMoves` is declared and content is moved in suggesting mode
- **THEN** the result is a `w:del` and a `w:ins`, not a `w:moveFrom`/`w:moveTo` pair

#### Scenario: An existing move is still a move

- **WHEN** the same document already contains a `w:moveFrom`/`w:moveTo` pair
- **THEN** it is presented and resolved as a move, because the setting governs writing rather than reading

#### Scenario: Formatting is applied untracked when the document says not to track it

- **WHEN** `w:doNotTrackFormatting` is declared and bold is applied in suggesting mode
- **THEN** the run's properties change and no `w:rPrChange` is written

### Requirement: One composition is one revision and one history entry

An IME composition SHALL commit as ONE `w:ins` and ONE D10 history entry, regardless of how many intermediate compositions the browser reports. A composition of a Japanese word produces a readback per keystroke; recording each as its own revision fills the review pane with a card per character and makes one word take a dozen undos to retract.

#### Scenario: A composed word is one card

- **WHEN** a five-keystroke composition commits in suggesting mode
- **THEN** the review surface lists one insertion whose text is the composed word

#### Scenario: A composed word is one undo

- **WHEN** the same composition is undone
- **THEN** the whole word is retracted in one step

#### Scenario: An abandoned composition writes nothing

- **WHEN** a composition is cancelled before it commits
- **THEN** no revision is written and the document is fingerprint-identical

### Requirement: A tracked edit outside the run vocabulary states what it becomes

Four other changes defer to this one for what tracking means in their vocabulary, and a requirement that does not exist cannot be deferred to. Each SHALL be stated here:

- **A tracked note insertion.** Inserting a footnote or endnote in suggesting mode SHALL wrap the REFERENCE in `w:ins` in the story. The note BODY in `footnotes.xml`/`endnotes.xml` SHALL NOT be wrapped: the reference is the thing that exists in the document, and rejecting the insertion removes the reference and cascades the body away with it, exactly as an untracked deletion of a reference does.
- **A tracked content-control value change.** Editing inside a `w:sdt` in suggesting mode SHALL track the CONTENT — the runs inside `w:sdtContent` — like any other run content. The `w:sdtPr` binding SHALL NOT be tracked, because a value change is not a change to the control.
- **A tracked drawing deletion.** Deleting a drawing in suggesting mode SHALL wrap its run in `w:del`. The drawing itself is not text and gets no `w:delText`; it stays inside the deletion unchanged, so rejecting restores it byte-identically and accepting removes the run and its relationship together.

#### Scenario: Rejecting a tracked note insertion takes the body with it

- **WHEN** a footnote inserted in suggesting mode is rejected
- **THEN** the reference is removed from the story and the note body is removed from `footnotes.xml`
- **AND** no orphan note body is left behind

#### Scenario: A content control's value tracks, its binding does not

- **WHEN** text inside a `w:sdt` is edited in suggesting mode
- **THEN** the runs inside `w:sdtContent` carry the revision
- **AND** `w:sdtPr` is unchanged

#### Scenario: A rejected drawing deletion restores the drawing exactly

- **WHEN** a tracked deletion of a drawing is rejected
- **THEN** the drawing subtree matches its input by canonical fingerprint
- **AND** its media relationship is still in the package

### Requirement: A display-mode switch invalidates layout without a model change

A display mode is a D12 **presentation** input, not a model input: it changes what layout produces and never what the document holds. It SHALL therefore be classed alongside zoom and page-view settings rather than alongside a `TreeDocOp`, and it SHALL NOT publish a `ModelChange`.

That leaves the invalidation question a `ModelChange` would otherwise answer. The mode SHALL be part of the layout cache KEY, carried by the measurement producer, so a change to it invalidates the per-block cache and the flow checkpoints of a change-scoped layout session by the ordinary key comparison. A session that only watched for `ModelChange` would hand back the pages it laid out in the previous mode.

#### Scenario: Switching modes re-lays out

- **WHEN** the display mode changes from all-markup to the proposed result
- **THEN** layout runs again and the pages reflect the new mode
- **AND** no `ModelChange` is published and no undo entry is created

#### Scenario: The document is untouched

- **WHEN** the mode is switched several times and the package is saved
- **THEN** the saved package matches the input by canonical fingerprint

#### Scenario: A cached session does not answer in the wrong mode

- **WHEN** a layout session has cached pages for all-markup and the mode changes
- **THEN** no cached page is returned by identity, because the mode is part of the cache key

### Requirement: The public revision and comment contracts describe what the engine models

`Revision` and `DocComment` are `@public`. They SHALL describe the document the engine actually reads, and where they did not, the correction is BREAKING and SHALL be released as such:

| Member | Was | Is | Why |
| --- | --- | --- | --- |
| `Revision.date` | required `string` | optional | `CT_TrackChange` makes `@w:date` optional. Required forced either a fabricated date — a content change — or dropping the revision |
| `Revision.part` | optional `'body' \| 'footnote' \| 'endnote'` | required part NAME | `@w:id` is unique only within a part, so an address without one names two revisions. The enum cannot express `header3.xml`, `comments.xml`, or `styles.xml`, which carries revisions whose ids collide with `document.xml` |
| `Revision.type` | `'insert' \| 'delete' \| 'format'` | plus `replace`, `moveFrom`, `moveTo`, `paragraphMark`, `structural` | A move resolved as a delete and an insert duplicates or loses content; a paragraph-mark revision decorates no characters and merges paragraphs; a row revision is structural. A reviewer shown three kinds never learns about the rest |
| `DocComment.date` | required | optional | Same as `Revision.date` |
| `DocComment` | no anchor | `anchor`, `orphaned` | A comment lives in `comments.xml` and is PLACED by markers in a story. Without the anchor a consumer cannot say where a comment is, and cannot tell a comment with no usable range from one anchored at offset zero |

#### Scenario: A dateless revision is listed

- **WHEN** a document carries a `w:ins` with no `@w:date`
- **THEN** it is listed with no date, and saving does not fabricate one

#### Scenario: A header revision is attributable

- **WHEN** a document's only revision is in `header3.xml`
- **THEN** it is listed with that part as its address, and resolving it names the same part

#### Scenario: Colliding ids in two parts are two revisions

- **WHEN** `styles.xml` and `document.xml` each carry a revision `w:id="0"`
- **THEN** they are two entries with different `part` values, and resolving one leaves the other untouched

#### Scenario: An orphaned comment says so

- **WHEN** a comment's range markers are missing
- **THEN** it is listed with `orphaned` set and no anchor, rather than being dropped or reported at offset zero
