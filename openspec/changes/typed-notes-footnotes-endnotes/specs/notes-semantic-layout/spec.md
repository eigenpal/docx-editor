## ADDED Requirements

### Requirement: A note body is a story

`storyBlocks` SHALL recognise a note node as a story root, alongside the body and the `w:hdr` / `w:ftr` roots it recognises today. A note story SHALL flow through the same block-flow path headers and footers use, so paragraphs, tables, and block-level SDT wrappers inside a note behave as they do elsewhere.

#### Scenario: Note text reaches a page

- **WHEN** the comprehensive fixture is laid out
- **THEN** the three footnote bodies and two endnote bodies produce fragments
- **AND** no note text is silently absent from the output

#### Scenario: Note story line ids are namespaced

- **WHEN** a note is laid out
- **THEN** its line ids are namespaced by note identity, so the body's line counter — which incremental convergence compares — does not move because a note changed

#### Scenario: Table inside a note

- **WHEN** a note body contains a table
- **THEN** it flows through the same table layout path as a body table, with the same span clamping and security guards

### Requirement: The footnote area is reserved on the referencing page

When resolved footnote position is `pageBottom`, a footnote's fragments SHALL be placed at the bottom of the page carrying its reference, above the bottom margin, below all body content. When it is `beneathText`, the area SHALL start immediately below the last body line. The area's height, including its separator, SHALL be subtracted from that page's available body height before pagination decides what fits.

#### Scenario: Reference and note share a page

- **WHEN** a reference falls on page 2 and its note fits
- **THEN** the note's fragments are on page 2

#### Scenario: Multiple references on one page

- **WHEN** three references fall on one page
- **THEN** their notes stack in reference order in one area under one separator

#### Scenario: The area shrinks the body box

- **WHEN** a page carries a footnote reference
- **THEN** the body content height available on that page is reduced by the area height before line placement, not after

#### Scenario: beneathText on a short page

- **WHEN** position resolves to `beneathText` and the page is half empty
- **THEN** the area starts under the last body line and the rest of the page is blank

#### Scenario: Footnote sectEnd

- **WHEN** footnote position resolves to `sectEnd`
- **THEN** footnote bodies for that section collect at the section end (same ownership rule as endnote `sectEnd`), not in a per-page bottom area

#### Scenario: Footnote docEnd

- **WHEN** footnote position resolves to `docEnd`
- **THEN** footnote bodies collect after the last section's body (same ownership rule as endnote `docEnd`)

### Requirement: The footnote feedback loop is bounded and its fallback is named

Reserving the area can push the referencing line to the next page, which moves the note, which changes the reservation. Layout SHALL bound the re-flow attempts for a page. On exhausting the bound it SHALL keep the reference and its note together on the later page, and SHALL record the fallback as an explicit layout reason, consistent with D12's conservative-fallback discipline.

#### Scenario: Line moves with its note

- **WHEN** the last body line on a page carries a reference whose note exceeds the remaining space
- **THEN** the line and its note both move to the next page rather than the note overlapping the bottom margin

#### Scenario: Oscillation terminates

- **WHEN** moving the line would free enough space to move it back
- **THEN** layout terminates within the bound, publishes one complete result, and reports the fallback reason
- **AND** the reason is a named value the conformance suite asserts on, not a log line

#### Scenario: Incremental equals full

- **WHEN** an edit changes a footnote's height and layout runs incrementally
- **THEN** the published pages equal a clean full layout of the same revision, including which page each note landed on

### Requirement: Long notes split under a continuation separator

A note body that does not fit on its referencing page SHALL split. The carried portion SHALL be preceded by the `continuationSeparator` note, and where the document supplies a `continuationNotice` it SHALL be drawn at the foot of the page the note continues from.

#### Scenario: Note splits

- **WHEN** a footnote body is taller than the page's available area
- **THEN** the first fragment renders on the referencing page and the remainder on the next page under the continuation separator

#### Scenario: Continuation shows no second mark

- **WHEN** a note splits under `numRestart="eachPage"`
- **THEN** the continued fragment displays no mark, and the next page's numbering counts references only

### Requirement: Endnotes are placed by resolved position and reserve nothing

Endnotes SHALL render after the body of the section carrying their reference when position resolves to `sectEnd`, and after the last section's body when it resolves to `docEnd`. They SHALL NOT reserve space on the referencing page.

#### Scenario: docEnd

- **WHEN** endnote position resolves to `docEnd` and references occur in sections 2 and 4 of five
- **THEN** both bodies render in reference order after section 5's content

#### Scenario: sectEnd

- **WHEN** position resolves to `sectEnd`
- **THEN** each section's endnotes render at the end of that section, before the next section's first page

#### Scenario: No reservation

- **WHEN** a page carries an endnote reference
- **THEN** its available body height is unchanged

### Requirement: Notes participate in semantic interaction

Note fragments SHALL carry the same stable paragraph identity and start-offset attributes the body uses, so hit-testing, caret stops, and selection geometry resolve inside a note through semantic records rather than DOM ranges, per D5. A note area SHALL NOT be page furniture.

#### Scenario: Click inside a note

- **WHEN** a pointer event lands in a painted note body
- **THEN** the hit test resolves to a position inside that note's story, not to the nearest body paragraph

#### Scenario: Note is selectable, furniture is not

- **WHEN** the user drags a selection through a note body
- **THEN** the note text selects
- **AND** the separator, the note mark's page furniture, and any header or footer marked `[data-docx-hf]` remain excluded from selection

#### Scenario: Reference mark is a caret stop boundary

- **WHEN** the caret moves across a `noteReference` with an arrow key
- **THEN** it steps over the reference as one unit rather than landing inside it

### Requirement: Note marks render from resolved styles

The reference mark and the note's own mark SHALL be styled by the document's resolved character styles (`FootnoteReference`, `EndnoteReference`) rather than by a hard-coded superscript.

#### Scenario: Superscript comes from the style

- **WHEN** `FootnoteReference` resolves `w:vertAlign="superscript"`
- **THEN** the mark renders superscript

#### Scenario: Redefined style is honoured

- **WHEN** a document redefines `FootnoteReference` without superscript
- **THEN** the mark renders as that style specifies, not forced superscript
