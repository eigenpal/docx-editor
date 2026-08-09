## ADDED Requirements

### Requirement: Field results are distinguishable from typed text

A field's displayed result SHALL be marked as such in layout, so a consumer can tell computed text from authored text. The mark SHALL state only the FACT — that the span is a field's result, and whether that field is a legacy form field — and SHALL carry no appearance.

`projected` SHALL NOT be used for this. It is also set for note marks and inline drawings, so it says that layout owns the glyphs rather than that they came from a field.

The mark SHALL be published on every span the result breaks into, since line breaking splits a field's result at its spaces like any other text.

#### Scenario: A form field is distinguishable from an ordinary one

- **WHEN** a document holds a `FORMTEXT` field and a `REF` field
- **THEN** each result is marked as a field, and only the first is marked as a legacy form field

#### Scenario: Ordinary text is unmarked

- **WHEN** a paragraph holds no fields
- **THEN** no span carries the mark

### Requirement: Field shading follows Word, and never prints

Field shading SHALL be presented as Word presents it: a neutral block behind a field's result, saying where the text came from. It is a view affordance and not document formatting, so it SHALL NOT be written to the file and SHALL NOT appear in print output.

Two independent rules SHALL govern it, because Word governs them separately:

- **Legacy form fields** (`w:fldChar/w:ffData`) follow the DOCUMENT. They SHALL be shaded unless `settings.xml` carries `w:doNotShadeFormData` (§17.15.1.49), whose absence therefore means shaded. They SHALL NOT be governed by the host preference below: a form's blanks are the document's own statement about itself.
- **Ordinary fields** follow the HOST, through an option of `never`, `when-selected` or `always`, defaulting to Word's own `when-selected`.

A revision's presentation SHALL outrank field shading where both apply. A field struck by a tracked deletion has to read as deleted first and as computed second.

#### Scenario: A form field is shaded by default

- **WHEN** a document containing a `FORMTEXT` field declares no `w:doNotShadeFormData`
- **THEN** its result is shaded

#### Scenario: The document can turn form shading off

- **WHEN** `settings.xml` carries `w:doNotShadeFormData`
- **THEN** form-field results are not shaded
- **AND** an explicit `w:val` of `0`, `false` or `off` turns shading back on

#### Scenario: The host preference governs ordinary fields only

- **WHEN** the host asks for `never`
- **THEN** ordinary field results are not shaded
- **AND** legacy form fields are still shaded

#### Scenario: A deleted field reads as deleted

- **WHEN** a field result is shaded and also enclosed by a tracked deletion
- **THEN** the deletion's strike and colour are what the reader sees

#### Scenario: Nothing is shaded in print

- **WHEN** a page carrying shaded fields is printed
- **THEN** no field shading appears

### Requirement: Caret-dependent shading costs no layout

`when-selected` SHALL be resolved from the caret without invalidating layout or repainting spans. Layout SHALL remain a pure function of content: folding a caret position into its cache key would remeasure the document on every arrow press, and resolving it during paint would rebuild every span just as often — both to change a background colour.

The mark SHALL be published whatever the mode, so a host can change the mode without relaying out.

#### Scenario: The caret moves the shading

- **WHEN** the caret moves into a field's result under `when-selected`
- **THEN** that field is shaded and any previously shaded field is not
- **AND** no layout pass runs

#### Scenario: A range selection shades nothing

- **WHEN** the selection is not collapsed
- **THEN** no field carries the caret-driven shading, so it cannot read as a second selection

#### Scenario: The mode is switchable without relayout

- **WHEN** the host changes the field-shading mode
- **THEN** the marks already published are enough to resolve the new mode
