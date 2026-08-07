## ADDED Requirements

### Requirement: A field's result carries the revision that encloses it

A field's displayed result SHALL be attributed to the tracked revision that encloses it, and SHALL be presented exactly as any other text under that revision would be — struck through for a deletion, marked as an insertion for an insertion, in the author's colour, and reachable from the review surface.

This SHALL hold for every complex field regardless of its instruction. `PAGE`, `REF`, `FORMTEXT` and any other field the engine paints from its cached result are one case, not several: the attribution belongs to the text, not to what computed it.

Both shapes a producer writes SHALL be covered:

- a wrapper around only the RESULT run, with `fldChar begin` and `fldChar end` outside it
- a wrapper around the whole `begin`…`end` run sequence

A field whose result runs carry DIFFERENT revision stacks SHALL resolve to the first. A well-formed field occupies one model unit and is one decision to accept or reject, so a split would name a boundary the model does not have.

A field result enclosed by a `w:hyperlink` SHALL carry that link, like every other run in it.

#### Scenario: A replaced form-field value reads as replaced

- **WHEN** a `w:del` encloses the result run of a `FORMTEXT` field whose `begin` and `end` sit outside it, laid out in all-markup
- **THEN** the result renders struck through and attributed to the deletion's author
- **AND** it is absent from the proposed result

#### Scenario: An inserted cross-reference reads as inserted

- **WHEN** a `w:ins` encloses a `REF` field's whole `begin`…`end` sequence, laid out in all-markup
- **THEN** the result renders marked as an insertion in the author's colour
- **AND** it is absent from the original view

#### Scenario: Nesting is preserved whole

- **WHEN** a tracked field result sits inside more than one revision wrapper
- **THEN** the full stack reaches the span, outermost first, as it would for an ordinary run

#### Scenario: Untracked fields are unchanged

- **WHEN** a field carries no enclosing revision
- **THEN** its result is attributed to nothing and paints as ordinary text

### Requirement: Every tracked character reaches the page attributed

In all-markup, every character the canonical tree places inside a content-revision wrapper SHALL reach layout inside a piece carrying that same revision. Text that the tree tracks and layout paints unattributed SHALL be treated as a defect, not as a presentation choice.

This SHALL be checked against real documents rather than only hand-written markup, because the shape that broke it — text inside a field result — is one no synthetic revision fixture had reason to build.

#### Scenario: The corpus is covered

- **WHEN** the fixture corpus is laid out in all-markup and each revision's tree-declared text is compared with the text attributed to it
- **THEN** no revision is missing any of its characters

### Requirement: A deleted field occupies a real deleted range

The model range a deletion publishes for an atomic field SHALL be the single unit that field reserved, in every display mode, and SHALL never begin before the paragraph does. Deleted ranges SHALL be recorded whether or not the deletion was laid out, because the characters occupy model offsets in every mode and the caret has to step over them in every mode.

#### Scenario: The range is the atom

- **WHEN** a tracked deletion encloses the result of a well-formed complex field
- **THEN** the deleted range is that field's own one-unit range
- **AND** it is reported in all-markup, where the deletion is visible, as well as in the modes that hide it

### Requirement: A revision wrapping a simple field stays a revision

`w:fldSimple` is a member of `EG_ContentRunContent`, which `CT_RunTrackChange` admits, so a content-revision wrapper SHALL accept it as a child and SHALL remain typed as a revision. Demoting the wrapper because of its child removes the revision itself, taking the content off the page and out of the review surface at once.

#### Scenario: An inserted simple field is still an insertion

- **WHEN** a `w:ins` contains a `w:fldSimple`
- **THEN** the wrapper types as an insertion carrying its provenance
- **AND** the field inside it stays a typed simple field

### Requirement: A simple field paints its cached result

`w:fldSimple` (§17.16.19) SHALL paint its cached result — the child runs it carries — as one projected piece. It SHALL continue to occupy exactly one UTF-16 model unit however long that result is, so `paragraphTextOf`, selection and the caret keep agreeing that the field is one thing.

This supersedes the exclusion of "body fields (including inert generic `w:fldSimple`)" in `semantic-paragraph-layout`, for rendering only. The instruction in `@w:instr` SHALL NOT be displayed and SHALL NOT be executed or resolved, and a nested field's markers and instruction inside the result SHALL contribute no text.

#### Scenario: The result is visible

- **WHEN** a paragraph holds text, a `w:fldSimple` whose result is a cross-reference, and more text
- **THEN** all three paint, in order
- **AND** the text after the field keeps the offsets it had when the field painted nothing

#### Scenario: An empty result still holds its place

- **WHEN** a `w:fldSimple` has no result content
- **THEN** nothing paints for it and it still occupies its single model unit

#### Scenario: The instruction never reaches the page

- **WHEN** a `w:fldSimple` carries an instruction in `@w:instr`
- **THEN** no part of that instruction is painted
