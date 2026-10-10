## Definitions

See `tracked-structural-paragraphs/spec.md` for the shared definitions (active suggesting-mode author, ISO 8601 UTC, semantically equivalent OOXML, revision triple, one PM transaction). They apply here too.

- **Full prior snapshot** — a complete copy of the relevant `*Base` schema-type contents at the moment of first edit per revision triple. Snapshots are frozen: subsequent edits within the same revision triple do NOT modify the snapshot. After every edit, the implementation compares all snapshotted fields against current values and removes the `*Change` entry if all fields equal current values.

## ADDED Requirements

### Requirement: Preserve run-property change markers on round-trip via a PM mark

The system SHALL parse `<w:rPrChange>` inside a run-level `<w:rPr>` (schema element `CT_RPrChange` at `wml.xsd:1820`; distinct from the paragraph-mark `CT_ParaRPrChange`) and store the prior run properties on the corresponding run as a `revision_change` inline mark with attrs `{ revisionId, author, date, prior }`. On save, the mark SHALL serialize back to `<w:rPrChange>` as the **last** child of the run's `<w:rPr>` (per `EG_RPrContent` ordering at `wml.xsd:1784`).

#### Scenario: Run-property change round-trips

- **GIVEN** a DOCX run with `<w:rPr><w:b/><w:rPrChange w:id="50" w:author="Jane" w:date="2026-05-28T10:00:00Z"><w:rPr/></w:rPrChange></w:rPr>` (bold added, prior was no rPr)
- **WHEN** parsed and re-serialized without edits
- **THEN** the output run's `<w:rPr>` contains `<w:b/>` followed by `<w:rPrChange/>` (rPrChange last); semantically equivalent to source

#### Scenario: Run-level rPrChange does not appear on paragraph marks

- **GIVEN** a paragraph whose `<w:pPr><w:rPr>` carries `<w:rPrChange>` (a paragraph-mark formatting change per `CT_ParaRPrChange`)
- **WHEN** parsed
- **THEN** the parsed data appears on the paragraph node's `paraRPrChange` attr per `tracked-structural-paragraphs/spec.md`, NOT as an inline `revision_change` mark on any run

### Requirement: Mark identity supports adjacent-run coalescing

The `revision_change` mark SHALL canonicalize its `prior` attr at creation: keys deterministically sorted and the object `Object.freeze`d. Implementations SHOULD reuse a shared `prior` reference when creating marks for runs that share a revision triple, so that PM `Mark.eq` returns true for adjacent runs and the painter can render them as a single span.

#### Scenario: Adjacent runs sharing a revision triple coalesce

- **GIVEN** two adjacent runs created in one command, each receiving a `revision_change` mark with the same revision triple and the same prior properties
- **WHEN** the marks are constructed and applied
- **THEN** `mark1.eq(mark2)` returns true; the painter renders them as a single contiguous span

### Requirement: Inline run-property revisions coexist with insertion/deletion marks

A single run MAY carry the `revision_change` mark together with the existing `insertion` or `deletion` marks. On serialization, the run's `<w:rPr>` carries `<w:rPrChange>` (last child); the run is wrapped by `<w:ins>` or `<w:del>` per the inline mark; schema-mandated child ordering is preserved.

#### Scenario: Bold-added on inserted text

- **GIVEN** a run wrapped in both `insertion` and `revision_change` marks
- **WHEN** serialized
- **THEN** the output has `<w:ins>...</w:ins>` wrapping a `<w:r>` whose `<w:rPr>` contains the current properties followed by `<w:rPrChange/>` carrying the prior formatting; `<w:rPrChange>` is the last child of `<w:rPr>`

### Requirement: Track run-property edits in suggesting mode

When suggesting mode is active, commands that modify run formatting (bold, italic, underline, font family, font size, color, highlight, strikethrough, subscript/superscript, character style) SHALL apply the new formatting AND apply a `revision_change` mark carrying a snapshot of the prior `rPr` per revision triple. The snapshot is frozen on first edit; subsequent edits within the same revision triple do not modify it. After every edit, if all snapshotted fields equal current values, the `revision_change` mark for that triple SHALL be removed.

#### Scenario: Toggle bold in suggesting mode

- **GIVEN** active suggesting-mode author "Jane", a non-bold selected run with no existing `revision_change` mark
- **WHEN** the user toggles bold on
- **THEN** the run is bold and carries `revision_change: { revisionId, author: 'Jane', date, prior: <full prior rPr snapshot including bold: false> }`

#### Scenario: Subsequent change in same session preserves frozen prior

- **GIVEN** a run with `revision_change: { revisionId: 100, prior: { bold: false, italic: false } }` and currently bold + italic
- **WHEN** the same author toggles underline on in the same suggesting session
- **THEN** the run is bold + italic + underline; the `revision_change.prior` for revision triple 100 remains `{ bold: false, italic: false }` unchanged

#### Scenario: Toggling property back to prior value clears the mark

- **GIVEN** a run with `revision_change: { revisionId: 100, prior: { bold: false } }` and currently bold
- **WHEN** the user toggles bold off in the same suggesting session
- **THEN** the run is no longer bold; the `revision_change` mark for triple 100 is removed; if no other rPr field differs from prior, no revision remains on the run

### Requirement: Accept and reject run-property revisions

Accepting `revision_change` on a run SHALL remove the mark (current formatting wins). Rejecting SHALL restore the run's `rPr` to the snapshot in `prior` (for fields present in `prior` only; other fields untouched) and remove the mark.

#### Scenario: Accept run-property revision

- **GIVEN** a run with `revision_change: { revisionId: 10, prior: { bold: false } }` and current `bold: true`
- **WHEN** `acceptChangeById(10)` is dispatched
- **THEN** the run remains bold; the `revision_change` mark is removed

#### Scenario: Reject run-property revision restores prior fields only

- **GIVEN** a run with `revision_change: { revisionId: 10, prior: { bold: false } }` and current `{ bold: true, italic: true }` (italic was set before this revision)
- **WHEN** `rejectChangeById(10)` is dispatched
- **THEN** the run is `{ bold: false, italic: true }` (italic untouched, only bold reverted); the mark is removed

### Requirement: Reject of any property-change attribute restores prior fields

For `pPrChange`, `paraRPrChange`, `tcPrChange`, `trPrChange`, `tblPrChange`, `tblPrExChange`, `tblGridChange`, `sectPrChange`, and the inline `revision_change` mark, rejection SHALL restore every field present in `prior` to the affected node/run/mark, even if the current value differs across multiple fields. Fields not present in `prior` SHALL be left at their current values.

#### Scenario: Reject paragraph-property change restores multiple fields at once

- **GIVEN** a paragraph with current `{ alignment: 'right', indent: 36, lineSpacing: 1.5 }` and `pPrChange: [{ revisionId: 7, prior: { alignment: 'left', indent: 0 } }]` (no prior lineSpacing in snapshot)
- **WHEN** `rejectChangeById(7)` is dispatched
- **THEN** the paragraph has `{ alignment: 'left', indent: 0, lineSpacing: 1.5 }` (lineSpacing untouched) and the `pPrChange` entry for triple 7 is removed

### Requirement: tblGridChange has no author or date on serialization

The system SHALL emit `<w:tblGridChange>` with **only the `w:id` attribute** (per `CT_TblGridChange` extending `CT_Markup` at `wml.xsd:893`, which does NOT inherit `w:author` or `w:date`). The serializer SHALL NOT emit `w:author` or `w:date` on this element even if the parser tolerantly accepted them on input.

#### Scenario: tblGridChange serialization omits author and date

- **GIVEN** a table with `tblGridChange: { revisionId: 40, prior: <prior grid> }`
- **WHEN** serialized
- **THEN** the output contains `<w:tblGridChange w:id="40">…</w:tblGridChange>` with no `w:author` and no `w:date` attribute

### Requirement: Painter renders inline revision-change cues subtly

Runs carrying a `revision_change` mark SHALL render with class `ep-revision-change` plus `data-revision-id`, `data-revision-author`, `data-revision-date` attributes. The CSS styling (subtle wavy underline or background tint) SHALL NOT visually conflict when combined with the `insertion` (green underline) or `deletion` (red strikethrough) marks.

#### Scenario: Revision-change-only run renders with neutral cue

- **GIVEN** a run carries only a `revision_change` mark (no insertion or deletion)
- **WHEN** painted
- **THEN** the run's text DOM has class `ep-revision-change` and `data-revision-id` matching the mark's id
