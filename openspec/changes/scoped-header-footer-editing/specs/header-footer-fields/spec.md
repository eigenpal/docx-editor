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

### Requirement: Page-number fields are evaluated in layout, per page, before measurement

`PAGE`, `NUMPAGES`, and `SECTIONPAGES` SHALL be evaluated during layout for the page the story is being attached to, and the evaluated text SHALL be what is measured. Evaluation SHALL NOT be a paint-time substitution into a line whose width was computed from the cached result: a line measured for `1` and painted with `12` mis-positions every tab stop, right-alignment, and centring on that line.

**Shipped for `PAGE` and `NUMPAGES`:** `field-projection.ts` / `finalizePageFieldProjection`, pinned by `field-projection.test.ts` and `paginated-surface-hf.test.ts`. **`SECTIONPAGES` and `w:pgNumType` honouring are not shipped.**

A header or footer story SHALL be laid out once per variant **per distinct evaluated-result geometry**. Pages whose field results measure to the same widths share one laid-out story; a page whose results measure differently gets its own. Evaluation SHALL apply no `TreeDocOp` and publish no `ModelChange`.

#### Scenario: One footer, many pages

- **WHEN** a footer containing `Page {PAGE} of {NUMPAGES}` applies to pages 3 through 9 of a 12-page document
- **THEN** page 3 shows "Page 3 of 12" and page 9 shows "Page 9 of 12"

#### Scenario: A wider result does not break alignment

- **WHEN** a right-aligned footer field evaluates to `9` on one page and `10` on the next
- **THEN** both are right-aligned to the same edge, because each was measured with its own evaluated text
- **AND** neither overflows the content box nor leaves a gap sized for the other page's value

#### Scenario: Centred and tab-positioned results stay positioned

- **WHEN** a centred footer reads `Page {PAGE} of {NUMPAGES}` across a document that crosses from single to double digits
- **THEN** every page's text is centred on its own measured width

#### Scenario: Layout is shared where the geometry is identical

- **WHEN** twenty pages of a footer evaluate to results of identical measured width
- **THEN** they share one laid-out story rather than producing twenty layouts

#### Scenario: Evaluation does not mutate the tree

- **WHEN** the same footer is laid out and painted across twenty pages
- **THEN** no `TreeDocOp` is applied and no `ModelChange` is published, and the saved `w:instrText` is unchanged

#### Scenario: Total pages is correct after pagination changes

- **WHEN** an edit changes the document from 12 pages to 13
- **THEN** every `NUMPAGES` in every header and footer shows 13 without a manual refresh
- **AND** every `PAGE` still shows its own page's number

#### Scenario: Page numbers are correct while the scope is being edited

- **WHEN** the user opens the footer scope on page 7 and types beside a `PAGE` field
- **THEN** the field continues to show 7 — the value for the page being edited — not a placeholder, not `1`, and not the field code
- **AND** the other pages continue to show their own numbers

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
