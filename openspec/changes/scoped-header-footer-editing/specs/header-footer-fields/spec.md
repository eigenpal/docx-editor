## ADDED Requirements

### Requirement: Fields are typed canonical nodes in both forms

The canonical tree SHALL type the complex field form — `w:fldChar` with `@w:fldCharType` of `begin`, `separate`, and `end`, with `w:instrText` carrying the instruction — and the simple form `w:fldSimple` with `@w:instr`. `@w:dirty` and `@w:fldLock` SHALL round-trip. A field SHALL NOT be flattened to its cached text.

#### Scenario: Complex PAGE field in a footer

- **WHEN** a footer contains begin / `PAGE` instruction / separate / cached result / end
- **THEN** the model holds a typed field whose instruction is `PAGE` and whose cached result is that content
- **AND** an unedited round trip matches by canonical fingerprint

#### Scenario: Complex field with an empty result

- **WHEN** a field emits `separate` immediately followed by `end`, as every footer in the comprehensive fixture does — the file carries no cached result anywhere
- **THEN** the field types with an empty cached result rather than failing to parse
- **AND** the empty result round-trips as empty; no result is fabricated on save
- **AND** cached-result preservation is tested against a fixture that actually has one, not against this file

#### Scenario: Simple field stays simple

- **WHEN** the document contains `w:fldSimple`, as the comprehensive fixture does seven times
- **THEN** it round-trips as a simple field and is not rewritten into the complex form

#### Scenario: Cached result is preserved, not recomputed on save

- **WHEN** a document whose `PAGE` fields cache stale values is loaded and saved without editing
- **THEN** the cached values are written back unchanged and `@w:dirty` is preserved where present

### Requirement: Every field instruction is inert except the page-number family

`PAGE`, `NUMPAGES`, and `SECTIONPAGES` SHALL be evaluated. Every other instruction SHALL be preserved, painted from its cached result, and never executed, resolved, or fetched. This preserves the fields-lane security posture: DDE, `INCLUDE*`, and any other external-inclusion instruction stay non-executable.

#### Scenario: Unknown instruction paints its cache

- **WHEN** a field carries an instruction outside the evaluated family
- **THEN** it round-trips intact and paints its cached result

#### Scenario: External-inclusion instruction performs no fetch

- **WHEN** a field instruction names a remote or local resource
- **THEN** no network or filesystem request is made at load, layout, paint, or save
- **AND** the field paints its cached result only

#### Scenario: Field instruction text is never a sink

- **WHEN** a field's instruction is rendered for debugging or inspection
- **THEN** it is set as text content, never built into DOM from a string

### Requirement: Page-number fields evaluate per painted page

`PAGE`, `NUMPAGES`, and `SECTIONPAGES` SHALL be evaluated at paint time against the page being painted, so one header or footer story renders different text on different pages while remaining one story with one editing scope.

#### Scenario: One footer, many pages

- **WHEN** a footer containing `Page {PAGE} of {NUMPAGES}` applies to pages 3 through 9 of a 12-page document
- **THEN** page 3 paints "Page 3 of 12" and page 9 paints "Page 9 of 12"
- **AND** the story is still laid out once per variant, not once per page

#### Scenario: Evaluation does not mutate the tree

- **WHEN** the same footer paints on twenty pages
- **THEN** no `TreeDocOp` is applied and no `ModelChange` is published by painting

#### Scenario: PAGE respects a section restart

- **WHEN** a section sets `w:pgNumType w:start="1"` partway through the document
- **THEN** `PAGE` in that section's footer evaluates against the restarted number

#### Scenario: PAGE respects the numbering format

- **WHEN** a section sets `w:pgNumType w:fmt="lowerRoman"`
- **THEN** `PAGE` paints `iv` rather than `4`

#### Scenario: NUMPAGES counts the document, SECTIONPAGES counts the section

- **WHEN** a 12-page document has a 4-page third section
- **THEN** `NUMPAGES` in that section's footer paints 12 and `SECTIONPAGES` paints 4

### Requirement: A field behaves as one unit while editing

While a header or footer scope is being edited, a field SHALL be one unit for caret movement and deletion. Typing SHALL NOT be able to land inside the instruction.

#### Scenario: Caret steps over the field

- **WHEN** the caret moves across a `PAGE` field with an arrow key
- **THEN** it steps from after the field to before it without stopping inside

#### Scenario: Deleting a field is atomic

- **WHEN** a field is selected and deleted
- **THEN** begin, instruction, separate, cached result, and end are removed in one transaction and no orphaned `w:fldChar` remains

#### Scenario: Typing beside a field

- **WHEN** the user types immediately after a `PAGE` field
- **THEN** the text becomes a new run outside the field and the instruction is unchanged

### Requirement: Inserting a page number produces a field, never literal text

The chrome SHALL offer `insert.pageNumber` and `insert.pageXofY`, wired in the slot→command table, and both SHALL emit typed field nodes.

#### Scenario: Insert page number

- **WHEN** the user invokes `insert.pageNumber` with the caret in a footer
- **THEN** a complex `PAGE` field is inserted with a cached result matching the current page
- **AND** the saved part contains `w:fldChar` and `w:instrText`, not a digit

#### Scenario: Insert page X of Y

- **WHEN** the user invokes `insert.pageXofY`
- **THEN** the inserted content is a localized label, a `PAGE` field, a localized separator, and a `NUMPAGES` field, with both strings resolved through the i18n layer

#### Scenario: Disabled outside a furniture scope

- **WHEN** focus is not in a header or footer scope
- **THEN** both controls render disabled with the engine's own reason
