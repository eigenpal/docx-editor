## ADDED Requirements

### Requirement: Note parts parse into typed canonical nodes

The canonical tree SHALL type `w:footnotes`, `w:endnotes`, `w:footnote`, and
`w:endnote` (kind `note`, discriminated by `localName`). Each note node SHALL
carry its numeric `w:id` and its authored `w:type` (`normal`, `separator`,
`continuationSeparator`, `continuationNotice`, or absent). Authored `normal`
SHALL round-trip and MUST NOT be normalised away. Note children SHALL be
ordinary block content — the same typed paragraph and table kinds the body uses
— with unknown content demoting to `generic` per D1.

The run-inner marks `w:footnoteRef` / `w:endnoteRef` (kind `noteRef`),
`w:separator`, and `w:continuationSeparator` SHALL also be typed. Each of
`noteReference`, `noteRef`, `separator`, and `continuationSeparator` SHALL
contribute exactly one UTF-16 unit (`U+FFFC`) to paragraph addressing.

#### Scenario: Both note parts type

- **WHEN** a package containing `word/footnotes.xml` and `word/endnotes.xml` is loaded
- **THEN** every `w:footnote` and `w:endnote` is a typed note node keyed by its `w:id`, including the negative and zero ids used for separators

#### Scenario: Note with block content

- **WHEN** a note body contains a `w:tbl`
- **THEN** it is a typed `table` node inside the note, not a `generic` subtree

#### Scenario: Misplaced known element demotes

- **WHEN** a note part contains a known element in a position the schema does not permit
- **THEN** it demotes to `generic` and is preserved in order, and loading does not fail

#### Scenario: Package with no note parts

- **WHEN** a package declares no footnote or endnote relationship
- **THEN** no note part, relationship, or content-type override is fabricated on save

### Requirement: Note references are typed run children

`w:footnoteReference` and `w:endnoteReference` SHALL be a typed `noteReference` node inside a typed `run`, carrying `noteKind`, `noteId`, and `customMarkFollows` from `CT_FtnEdnRef`. A note reference SHALL NOT be represented as text and SHALL NOT remain a `generic` node.

#### Scenario: Reference is addressable

- **WHEN** a caller walks the runs of a paragraph carrying a note reference
- **THEN** the reference is discriminable by node kind without inspecting a string
- **AND** the paragraph's UTF-16 text offsets — the addressing `TreeDocOp` uses — account for the reference's position without inserting a digit into the text

#### Scenario: Reference round-trips

- **WHEN** a paragraph containing `w:footnoteReference w:id="2"` is loaded, left unedited, and serialized
- **THEN** the canonical fingerprint of that paragraph is unchanged

#### Scenario: Dangling reference

- **WHEN** a reference names a `noteId` with no note body
- **THEN** loading SHALL succeed and the reference SHALL be retained
- **AND** the condition SHALL be reported as a load diagnostic rather than throwing, matching the fail-open behaviour `resolveHeaderFooterParts` already uses for a dangling `r:id`

### Requirement: Note properties resolve section-then-document-then-default

Note properties SHALL be read per `CT_FtnProps` and `CT_EdnProps`: `pos`, `numFmt`, and the `EG_FtnEdnNumProps` group (`numStart`, `numRestart`). Resolution SHALL be the section's `w:sectPr` value, else the `w:settings` document value, else the OOXML default. Authored and resolved values SHALL stay distinguishable.

#### Scenario: Document declares nothing

- **WHEN** neither `word/settings.xml` nor any `w:sectPr` declares `w:footnotePr` or `w:endnotePr`, as in the comprehensive fixture
- **THEN** footnote position resolves to `pageBottom`, endnote position to `docEnd`, `numRestart` to `continuous`, and `numStart` to 1
- **AND** serializing the unedited document adds no `w:footnotePr` or `w:endnotePr` element

#### Scenario: Section overrides the document

- **WHEN** the document declares `numFmt="decimal"` and one section declares `numFmt="lowerRoman"`
- **THEN** references in that section resolve to `lowerRoman` and references elsewhere to `decimal`

#### Scenario: Position is constrained by note kind

- **WHEN** an operation sets an endnote position to `pageBottom`
- **THEN** it is refused with `invalidArgs`, because `ST_EdnPos` admits only `sectEnd` and `docEnd`
- **AND** the store publishes no `ModelChange`

### Requirement: Displayed note numbers are derived, never stored

The number rendered for a note SHALL be computed from the document order of its references under the resolved numbering properties. It SHALL NOT be stored on the note node or on the reference node.

#### Scenario: Insert renumbers the tail

- **WHEN** a footnote is inserted before two footnotes displaying 1 and 2
- **THEN** the new note displays 1 and the existing ones display 2 and 3
- **AND** neither existing note's `w:id` changes, and neither note's canonical subtree is rewritten

#### Scenario: Custom mark suppresses automatic numbering

- **WHEN** a reference sets `customMarkFollows="1"` and the following run supplies the mark
- **THEN** that reference displays the custom mark and consumes no number from the automatic sequence

#### Scenario: numFmt is applied at display, not at parse

- **WHEN** `numFmt` resolves to `lowerRoman`
- **THEN** the fourth note displays `iv`
- **AND** changing `numFmt` re-derives every displayed mark without a tree mutation to any note

### Requirement: Separator notes are read from the document, not synthesised

`w:separator`, `w:continuationSeparator`, and `w:continuationNotice` notes SHALL be read from the note part and referenced through `CT_FtnDocProps` / `CT_EdnDocProps`. A default separator SHALL be supplied only when the document supplies none.

#### Scenario: Document supplies a separator

- **WHEN** the note part declares a `w:type="separator"` note
- **THEN** that note's content is what is drawn above the footnote area

#### Scenario: Separator carrying a stray note reference

- **WHEN** a `w:type="separator"` note contains a `w:footnoteRef` run, as the comprehensive fixture's does
- **THEN** loading succeeds, the separator draws no note number, and the stray run round-trips unchanged rather than being normalised away

### Requirement: Note operations commit through the store

`TreeDocOp` SHALL include `insertNote`, `deleteNote`, `setNoteProperties`, and
`convertNote`. Each SHALL commit atomically through
`TreePackageStore.applyLifecycleOp` (package snapshot undo), publishing one
`ModelChange`. A rejected operation SHALL publish nothing.

`TreePackageStore` SHALL expose `StoryScope { kind: 'notesPart'; noteKind }` —
one lazy store per footnotes/endnotes part, resolved through safe Internal
document relationships. Editing focus uses shipped
`EditorScope { kind: 'note'; id }` with canonical id encoding
`footnote:<signed-id>` / `endnote:<signed-id>`.

#### Scenario: Insert allocates an unused id

- **WHEN** insert-footnote runs on a document whose highest footnote id is 3
- **THEN** the new note takes an id not in use and not a separator id
- **AND** the reference node and the note body commit in one transaction, producing one `ModelChange` and one semantic history entry per D10

#### Scenario: Deleting a reference deletes its note

- **WHEN** the text range covering a `noteReference` is deleted
- **THEN** the note body is removed in the same transaction
- **AND** one undo restores both

#### Scenario: Deleting a note body deletes its reference

- **WHEN** delete-note runs for a note that has a reference
- **THEN** the reference node is removed wherever it occurs, including inside a header, footer, or another note

#### Scenario: Converting a footnote to an endnote

- **WHEN** convert-note converts footnote id 2 to an endnote
- **THEN** the body moves to the endnote part under a newly allocated endnote id, the reference node becomes an endnote reference in place, both sequences re-derive their numbers, and it is one transaction

#### Scenario: Impact class is honest

- **WHEN** a note operation commits
- **THEN** the published `ModelChange` carries an impact class no narrower than `flow-structural`, because a note changes the referencing page's available height

### Requirement: Note parts satisfy both D9 oracles

Note parts SHALL pass both repository-owned oracles: the namespace-aware canonical tree fingerprint on an unedited round trip, and the save/reopen semantic digest after a note edit. Passing one SHALL NOT compensate for failing the other.

#### Scenario: Canonical fingerprint after an unrelated edit

- **WHEN** a document is loaded, a body paragraph is edited, and the package is saved
- **THEN** `word/footnotes.xml` and `word/endnotes.xml` match their input by canonical tree fingerprint

#### Scenario: Semantic digest after a note edit

- **WHEN** a note body is edited, saved, and reopened
- **THEN** the save/reopen semantic digest reports the edited note's identity, text, and accepted properties as equivalent, and every other note as unchanged

#### Scenario: Preserved generic content survives

- **WHEN** a note part contains markup outside this vocabulary
- **THEN** it is preserved in order and reported by the digest's preserved-generic-node comparison

### Requirement: Note identifiers are allocated inside the range Word accepts

`CT_FtnEdn/@w:id` is `ST_DecimalNumber` — `xsd:integer`, unbounded in the schema — while Word treats it as a signed 32-bit integer. Allocation SHALL seed from the maximum note id already present in the relevant note part, plus one, clamped to signed 32-bit, and SHALL NOT derive an id from a clock, timestamp, random source, or hash.

Negative and zero ids are **reserved**: the comprehensive fixture uses `-1` for `separator` and `0` for `continuationSeparator`. Allocation SHALL only produce positive ids, and SHALL NOT reuse a reserved value even when no separator note occupies it.

#### Scenario: Seeded from the document

- **WHEN** a footnote is inserted into a document whose highest footnote id is 3
- **THEN** the allocated id is 4, not a clock-derived value

#### Scenario: Reserved ids are never allocated

- **WHEN** a note id is allocated for a part containing no separator notes
- **THEN** the allocated id is still positive; `-1` and `0` are not reused

#### Scenario: Exported ids stay inside signed 32-bit

- **WHEN** a package containing engine-authored notes is saved and opened in Word
- **THEN** it opens without a repair prompt
- **AND** a conformance test asserts the bound directly rather than relying on schema validation

#### Scenario: Footnote and endnote spaces are independent

- **WHEN** ids are allocated in both parts
- **THEN** each is seeded from its own part's maximum, and a footnote id does not constrain an endnote id
