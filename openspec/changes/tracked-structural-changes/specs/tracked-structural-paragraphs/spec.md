## Definitions

These definitions apply throughout this capability spec.

- **Active suggesting-mode author** — the `author` string returned by `getSuggestingModeConfig().author` (in `packages/core/src/prosemirror/plugins/suggestionMode.ts`) at the moment the command is dispatched. If `null` or empty, suggesting mode is off and the command SHALL NOT create revision attrs.
- **ISO 8601 UTC** — `YYYY-MM-DDTHH:MM:SSZ`. No fractional seconds, no non-UTC offsets on serialization. The parser SHALL accept any valid `xsd:dateTime` (including offsets, fractional seconds) and normalize to UTC. Missing `w:date` is tolerated as `null`.
- **Semantically equivalent OOXML** — same element with same parent, same attribute _values_ on the marker. Attribute ordering, namespace prefix variation, and self-closing vs open/close form are NOT distinguished. The test harness uses `assertOoxmlEquivalent(a, b)`.
- **Revision triple** — `(w:id, w:author, w:date)`. The grouping key for `acceptChangeById`, sidebar entries, and multi-site resolution. Bare `w:id` is NOT sufficient (cross-author id collisions are legal per ECMA-376 since `w:id` is not author-scoped).
- **One PM transaction** — observable as exactly one undo step after the command completes.

## ADDED Requirements

### Requirement: Preserve paragraph-mark insertion markers on round-trip

The system SHALL parse `<w:pPr><w:rPr><w:ins/></w:rPr></w:pPr>` from a DOCX as a paragraph-mark insertion revision, store it on the corresponding paragraph node as `pPrIns: { revisionId, author, date }`, and serialize it back. Serialization SHALL place the `<w:ins/>` element **first** inside `<w:rPr>` (per `EG_ParaRPrTrackChanges` schema ordering at `wml.xsd:1837`).

#### Scenario: Paragraph-mark insertion round-trips

- **GIVEN** a DOCX containing a paragraph whose `<w:pPr><w:rPr>` carries `<w:ins w:id="42" w:author="Jane" w:date="2026-05-28T10:00:00Z"/>`
- **WHEN** the document is parsed and immediately serialized back without edits
- **THEN** the output DOCX contains an `<w:ins/>` element on the same paragraph with `w:id="42"`, `w:author="Jane"`, `w:date="2026-05-28T10:00:00Z"`, and `assertOoxmlEquivalent` returns true for the surrounding `<w:rPr>` content

### Requirement: Preserve paragraph-mark deletion markers on round-trip

The system SHALL parse `<w:pPr><w:rPr><w:del/></w:rPr></w:pPr>` from a DOCX, store it on the paragraph node as `pPrDel: { revisionId, author, date }`, and serialize it back in the same first-position inside `<w:rPr>`.

#### Scenario: Paragraph-mark deletion round-trips

- **GIVEN** a DOCX whose paragraph carries `<w:pPr><w:rPr><w:del w:id="7" w:author="Jane" w:date="2026-05-28T10:00:00Z"/></w:rPr></w:pPr>`
- **WHEN** parsed and re-serialized
- **THEN** the output retains the `<w:del/>` element semantically equivalent on that paragraph

### Requirement: Track paragraph split as a paragraph-mark insertion on the first paragraph

When suggesting mode is active, pressing Enter to split a paragraph SHALL leave the document structure split and SHALL set `pPrIns` on the **first** of the two resulting paragraphs (the normative orientation). The implementation SHALL invoke `splitBlockClearBorders` from `BaseKeymapExtension` to preserve paragraph-style inheritance and border-clearing behavior, then set the `pPrIns` attr in the same PM transaction.

#### Scenario: Enter mid-paragraph in suggesting mode sets pPrIns on the first paragraph

- **GIVEN** the active suggesting-mode author is "Jane" and a paragraph reads "Hello world" with the caret between "Hello" and " world"
- **WHEN** the user presses Enter
- **THEN** the document contains two paragraphs ("Hello" and " world"); the **first** paragraph (P1, "Hello") carries `pPrIns: { revisionId, author: "Jane", date: <ISO 8601 UTC> }`; the **second** paragraph (P2, " world") carries no new revision attr; the caret is at the start of P2; one PM transaction is generated

#### Scenario: Enter with a non-collapsed selection in suggesting mode

- **GIVEN** the active suggesting-mode author is set and the selection covers "wor" within "Hello world"
- **WHEN** the user presses Enter
- **THEN** "wor" is wrapped in a deletion mark (existing behavior), the paragraph is split at the selection's `from`, and the first resulting paragraph carries `pPrIns`

#### Scenario: Enter in an empty paragraph

- **GIVEN** an empty paragraph and the active suggesting-mode author is set
- **WHEN** the user presses Enter
- **THEN** two empty paragraphs exist; the first carries `pPrIns`; the caret is at the start of the second; one PM transaction is generated

### Requirement: Track paragraph join as a paragraph-mark deletion

When suggesting mode is active, pressing Backspace at the start of a non-first paragraph (collapsed selection) SHALL NOT join the paragraphs. It SHALL set `pPrDel` on the previous paragraph and place the caret at the end of that paragraph. Pressing Delete at the end of a non-last paragraph (collapsed selection) SHALL set `pPrDel` on the current paragraph. Pressing Backspace at the start of the first paragraph SHALL be a no-op.

#### Scenario: Backspace at paragraph start in suggesting mode

- **GIVEN** two paragraphs "Hello" and "world" exist, the caret is at the start of "world", suggesting mode is active
- **WHEN** the user presses Backspace
- **THEN** the paragraphs remain split; "Hello" gains `pPrDel: { revisionId, author, date }`; the caret is at the end of "Hello"; one PM transaction is generated

#### Scenario: Delete at paragraph end in suggesting mode

- **GIVEN** paragraphs "Hello" and "world", caret at end of "Hello", suggesting mode active
- **WHEN** the user presses Delete
- **THEN** the paragraphs remain split; "Hello" gains `pPrDel`; the caret stays at end of "Hello"

#### Scenario: Backspace at start of first paragraph is a no-op

- **GIVEN** the caret is at the start of the document's first paragraph
- **WHEN** the user presses Backspace in suggesting mode
- **THEN** no transaction is dispatched; no revision attr is set

#### Scenario: Selection spanning paragraph boundary then deletion in suggesting mode

- **GIVEN** the selection extends from position `from` inside paragraph A through position `to` at the start of paragraph B
- **WHEN** the user presses Backspace or Delete
- **THEN** the inline content from `from` to `to` gains a deletion mark; A gains `pPrDel`; the cursor lands at position `from`

### Requirement: Accept and reject paragraph-mark revisions

The system SHALL extend accept/reject to operate on `pPrIns` and `pPrDel` attrs per Word semantics, addressable by `acceptChangeById(revisionId)` and `rejectChangeById(revisionId)`. The commands SHALL group sites by the revision triple `(id, author, date)` and resolve all matching sites in one PM transaction.

Per-marker rules:

- `pPrIns` accept: clear the attr; structure stays split.
- `pPrIns` reject: clear the attr **and** join with the following paragraph; the joined paragraph inherits the _second_ paragraph's `pPr`.
- `pPrDel` accept: join with the following paragraph; the joined paragraph inherits the second paragraph's `pPr`; clear the attr.
- `pPrDel` reject: clear the attr; structure stays split.

#### Scenario: Accept a paragraph-mark insertion

- **GIVEN** a paragraph with `pPrIns: { revisionId: 42, ... }`
- **WHEN** `acceptChangeById(42)` is dispatched
- **THEN** the paragraph remains split; its `pPrIns` attr is `null`; one PM transaction is generated

#### Scenario: Reject a paragraph-mark insertion inherits the second paragraph's pPr

- **GIVEN** paragraph P1 "Hello" with `pPrIns: { revisionId: 42, ... }` and `alignment: 'left'`; paragraph P2 "world" with `alignment: 'right'`
- **WHEN** `rejectChangeById(42)` is dispatched
- **THEN** the two paragraphs are joined into one paragraph "Helloworld" with `alignment: 'right'` (P2's pPr wins); the `pPrIns` attr no longer exists

#### Scenario: Accept a paragraph-mark deletion

- **GIVEN** paragraph P1 "Hello" with `pPrDel: { revisionId: 7, ... }`; paragraph P2 "world"
- **WHEN** `acceptChangeById(7)` is dispatched
- **THEN** P1 and P2 are joined; the resulting paragraph inherits P2's `pPr`

#### Scenario: Reject a paragraph-mark deletion

- **GIVEN** a paragraph with `pPrDel: { revisionId: 7, ... }`
- **WHEN** `rejectChangeById(7)` is dispatched
- **THEN** the paragraph remains split; its `pPrDel` is `null`

#### Scenario: Reject pPrIns on the last paragraph of the document

- **GIVEN** the document's last paragraph carries `pPrIns: { revisionId: 88, ... }` and there is no following sibling at the same depth
- **WHEN** `rejectChangeById(88)` is dispatched
- **THEN** the attr is cleared; no join is performed; the command logs a diagnostic and returns `true`

#### Scenario: Accept pPrDel on the first paragraph of the document

- **GIVEN** the document's first paragraph carries `pPrDel: { revisionId: 91, ... }`
- **WHEN** `acceptChangeById(91)` is dispatched
- **THEN** the attr is cleared; no join is performed (there is no previous paragraph); the command logs a diagnostic and returns `true`

#### Scenario: acceptChangeById on an unknown revisionId

- **WHEN** `acceptChangeById(999999)` is dispatched and no node or mark in the document carries that id
- **THEN** no transaction is dispatched and the command returns `false`

#### Scenario: acceptChangeById on an already-resolved revisionId

- **GIVEN** revision 42 was previously accepted and no longer appears in the document
- **WHEN** `acceptChangeById(42)` is dispatched again
- **THEN** no transaction is dispatched and the command returns `false`

#### Scenario: Adjacent paragraphs each carrying pPrIns

- **GIVEN** paragraph P1 with `pPrIns: { revisionId: 50 }`, paragraph P2 with `pPrIns: { revisionId: 51 }`, paragraph P3 with no revision
- **WHEN** `rejectChangeById(51)` is dispatched
- **THEN** P2 joins with P3; the joined paragraph carries P3's pPr; P1's `pPrIns: 50` is unchanged

### Requirement: Track paragraph-property changes with freeze-on-first-edit semantics

When suggesting mode is active, commands that modify paragraph properties (alignment, indentation, line spacing, paragraph style, list assignment) SHALL set `pPrChange: [{ revisionId, author, date, prior }]` on the affected paragraph (array, to allow stacking from multiple authors). On the first edit per revision triple, `prior` SHALL be a **full snapshot** of the paragraph's pPr at edit start (matching the `CT_PPrBase` schema). On subsequent edits in the same revision triple, the snapshot SHALL NOT be modified. After every edit, the implementation SHALL compare every snapshotted field against current values; if all fields equal current values, the matching `pPrChange` entry SHALL be removed.

#### Scenario: Change alignment in suggesting mode

- **GIVEN** active suggesting-mode author "Jane", a paragraph with `alignment: 'left', indent: 0` and no existing `pPrChange`
- **WHEN** the user changes alignment to right
- **THEN** the paragraph node has `alignment: 'right'` and `pPrChange: [{ revisionId: <new>, author: 'Jane', date: <ISO UTC>, prior: { alignment: 'left', indent: 0, ...other current pPr } }]`

#### Scenario: Subsequent property edit in same session preserves prior snapshot

- **GIVEN** a paragraph with `pPrChange: [{ revisionId: 100, prior: { alignment: 'left', indent: 0 } }]`, currently right-aligned
- **WHEN** the same author changes indent to 36pt in the same suggesting session
- **THEN** the paragraph's `pPrChange[0].prior` remains `{ alignment: 'left', indent: 0 }` unchanged

#### Scenario: Toggling property back to prior value clears the pPrChange

- **GIVEN** a paragraph with `pPrChange: [{ revisionId: 100, prior: { alignment: 'left' } }]`, currently right-aligned
- **WHEN** the user toggles alignment back to left
- **THEN** the paragraph has `alignment: 'left'` and `pPrChange: null` (or `[]`) — the no-op net change clears the revision

#### Scenario: Stacking changes from a different author appends a new entry

- **GIVEN** a paragraph with `pPrChange: [{ revisionId: 100, author: 'Jane', prior: { alignment: 'left' } }]`, currently right-aligned, then the active suggesting-mode author switches to "Bob"
- **WHEN** Bob changes indent to 36pt
- **THEN** the paragraph's `pPrChange` is `[{ revisionId: 100, author: 'Jane', ... }, { revisionId: <new>, author: 'Bob', prior: { ..., indent: 0 } }]`

### Requirement: Reject paragraph-property change restores prior state

Rejecting a specific `pPrChange` entry SHALL restore every field present in that entry's `prior` to the paragraph's own attrs and remove that entry from the `pPrChange` array. Fields not present in `prior` SHALL be left at their current values.

#### Scenario: Reject restores prior alignment and indent

- **GIVEN** a paragraph with current `{ alignment: 'right', indent: 36, lineSpacing: 1.5 }` and `pPrChange: [{ revisionId: 100, prior: { alignment: 'left', indent: 0 } }]`
- **WHEN** `rejectChangeById(100)` is dispatched
- **THEN** the paragraph has `{ alignment: 'left', indent: 0, lineSpacing: 1.5 }` (lineSpacing untouched) and `pPrChange` no longer contains the entry with `revisionId: 100`

### Requirement: Cross-revision rejection preserves inner revisions when possible

When rejecting a `pPrIns` on a paragraph that also carries `pPrChange` entries, the implementation SHALL first reject the `pPrChange` entries (restoring prior properties to the paragraph's attrs) if and only if the `pPrIns` rejection would remove the host paragraph from the document. Otherwise inner revisions SHALL be preserved on the surviving paragraph.

#### Scenario: Reject pPrIns first rejects host's pPrChange

- **GIVEN** paragraph P1 with `pPrIns: { revisionId: 42 }` and `pPrChange: [{ revisionId: 100, prior: { alignment: 'left' } }]`, currently right-aligned; followed by P2
- **WHEN** `rejectChangeById(42)` is dispatched
- **THEN** P1's `pPrChange` is rejected first (alignment restored to left), then P1 joins with P2; the joined paragraph inherits P2's pPr (so the alignment in the result is P2's alignment, not P1's restored); one PM transaction is generated

### Requirement: Painter renders revision cues for paragraph revisions

The visible page renderer SHALL paint:

- A pilcrow `<span class="ep-revision-pilcrow ep-revision-ins" data-revision-id="<id>" data-revision-author="<author>" data-revision-date="<date>">¶</span>` at the end of any paragraph with `pPrIns`, styled with the insertion color via CSS.
- The same element with class `ep-revision-pilcrow ep-revision-del` for `pPrDel`, styled with the deletion color and strikethrough.
- A vertical change bar in the page margin for any paragraph with `pPrChange`, `paraRPrChange`, `pPrIns`, `pPrDel`, or `sectPrChange`.

#### Scenario: Inserted paragraph shows an insertion pilcrow

- **GIVEN** a paragraph carries `pPrIns: { revisionId: 42, author: 'Jane', date: '2026-05-28T10:00:00Z' }`
- **WHEN** the page is painted
- **THEN** the painted paragraph DOM contains `<span class="ep-revision-pilcrow ep-revision-ins" data-revision-id="42" data-revision-author="Jane" data-revision-date="2026-05-28T10:00:00Z">¶</span>` and the margin shows a change bar

#### Scenario: Deleted paragraph shows a strikethrough pilcrow

- **GIVEN** a paragraph carries `pPrDel`
- **WHEN** painted
- **THEN** the painted DOM contains `<span class="ep-revision-pilcrow ep-revision-del" …>¶</span>`

### Requirement: Selection across deferred-join paragraph boundaries

Arrow-key navigation across a paragraph boundary where the preceding paragraph carries `pPrDel` SHALL traverse the boundary normally (one keypress per boundary). The visual appearance of the deferred-join boundary is purely cosmetic; the PM selection model is unchanged.

Note: This is the Phase 1 behavior. A follow-up issue may evaluate a NodeView wrapper to virtualize the boundary so navigation feels joined; that is out of scope for this capability.

#### Scenario: ArrowRight at end of pPrDel paragraph moves into next paragraph

- **GIVEN** paragraph A has `pPrDel` and is followed by paragraph B
- **WHEN** the caret is at the end of A and the user presses ArrowRight
- **THEN** the caret moves into the position at the start of B (a normal paragraph boundary crossing)

### Requirement: Preserve section-property changes on round-trip

The system SHALL parse `<w:sectPrChange>` from `<w:sectPr>` at both placements (inside a paragraph's `<w:pPr>` and as a direct child of `<w:body>`). It SHALL store the prior section properties on the corresponding paragraph node as `sectPrChange: { revisionId, author, date, prior }` and `sectPrChangeBodyLevel: boolean` (true if the sectPr was body-level). On serialization, the `sectPrChange` element SHALL be the **last** child of `<w:sectPr>` in its source placement.

#### Scenario: Section-property change round-trips at body-level

- **GIVEN** a DOCX whose `<w:body>` ends with `<w:sectPr>…<w:sectPrChange w:id="9" w:author="Jane" w:date="…"><w:sectPr>…prior…</w:sectPr></w:sectPrChange></w:sectPr>` (single-section doc, body-level placement)
- **WHEN** parsed and re-serialized
- **THEN** the output retains the `<w:sectPrChange>` element at body-level with semantically equivalent prior section properties; `sectPrChangeBodyLevel` is `true` on the synthetic terminator paragraph attr

#### Scenario: Section-property change round-trips inside pPr

- **GIVEN** a paragraph in the middle of a multi-section document whose `<w:pPr><w:sectPr>` carries `<w:sectPrChange>`
- **WHEN** parsed and re-serialized
- **THEN** the output retains the `<w:sectPrChange>` element inside the paragraph's `<w:pPr><w:sectPr>`; `sectPrChangeBodyLevel` is `false`

### Requirement: Accept and reject section-property changes

Accepting `sectPrChange` SHALL clear the attr. Rejecting SHALL restore every field in `prior` to the section's properties and clear the attr.

#### Scenario: Reject section-property change restores prior

- **GIVEN** a section has `pageWidth: 12240, pageHeight: 15840` and the terminating paragraph has `sectPrChange: { revisionId: 9, prior: { pageWidth: 15840, pageHeight: 12240 } }`
- **WHEN** `rejectChangeById(9)` is dispatched
- **THEN** the section reverts to `pageWidth: 15840, pageHeight: 12240` and `sectPrChange` is `null`

### Requirement: Preserve paragraph-mark formatting changes (CT_ParaRPrChange)

The system SHALL parse `<w:rPrChange>` inside `<w:pPr><w:rPr>` as a paragraph-mark formatting change (schema element `CT_ParaRPrChange` at `wml.xsd:938`, distinct from the run `CT_RPrChange`). It SHALL store the prior paragraph-mark formatting on the paragraph node as `paraRPrChange: [{ revisionId, author, date, prior }]`. On serialization, the element SHALL be the **last** child of `<w:pPr><w:rPr>` (per `EG_RPrContent` ordering).

#### Scenario: Paragraph-mark formatting change round-trips

- **GIVEN** a DOCX whose `<w:pPr><w:rPr>` carries `<w:b/><w:rPrChange w:id="60" w:author="Jane" w:date="…"><w:rPr/></w:rPrChange>` (paragraph mark is currently bold, prior had no formatting)
- **WHEN** parsed and re-serialized without edits
- **THEN** the output retains the `<w:rPrChange>` element as the last child of `<w:pPr><w:rPr>`, semantically equivalent to source

#### Scenario: Reject paragraph-mark formatting change restores prior

- **GIVEN** a paragraph with `paraRPrChange: [{ revisionId: 60, prior: { bold: false } }]` and current paragraph-mark `bold: true`
- **WHEN** `rejectChangeById(60)` is dispatched
- **THEN** the paragraph-mark formatting reverts to `bold: false`; the entry is removed from `paraRPrChange`
