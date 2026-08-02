## ADDED Requirements

### Requirement: Content controls are typed canonical nodes at every level

The canonical tree SHALL type `w:sdt` and `w:sdtContent` at block, inline, row, and cell level. The wrapper SHALL NOT remain a `generic` node. Content inside `w:sdtContent` SHALL use the existing typed kinds, with unknown content demoting to `generic` per D1.

#### Scenario: Block control in the body

- **WHEN** a `w:sdt` wrapping a paragraph appears in the body
- **THEN** it is a typed control node whose content is the typed paragraph

#### Scenario: Block control inside a table cell

- **WHEN** a `w:sdt` wrapping a paragraph appears inside `w:tc`, as five controls in the comprehensive fixture do
- **THEN** it types the same way as in the body, and the cell's block content includes the control

#### Scenario: Inline control wrapping runs

- **WHEN** a `w:sdt` appears in run position inside a paragraph, as the fixture's four checkbox-style controls do
- **THEN** it is a typed inline control node
- **AND** its runs contribute to the paragraph's UTF-16 text and offsets, so `TreeDocOp` addressing over that paragraph is total

#### Scenario: Row and cell level controls

- **WHEN** a `w:sdtContent` contains `w:tr` or `w:tc`
- **THEN** the control types at that level and the rows or cells remain typed table content

### Requirement: `CT_SdtPr` is typed in schema order

Control properties SHALL be typed per `CT_SdtPr`, which is an `xsd:sequence`: `rPr`, `alias`, `tag`, `id`, `lock`, `placeholder`, `temporary`, `showingPlcHdr`, `dataBinding`, `label`, `tabIndex`, followed by at most one type element from `equation`, `comboBox`, `date`, `docPartObj`, `docPartList`, `dropDownList`, `picture`, `richText`, `text`, `citation`, `group`, `bibliography`. Serialization SHALL re-emit them in that order. Properties outside this vocabulary SHALL be preserved as generic children in position.

#### Scenario: Order is preserved on round trip

- **WHEN** a control declaring `alias`, `tag`, `id`, `showingPlcHdr`, and `dropDownList` is loaded and serialized unedited
- **THEN** the `w:sdtPr` matches its input by canonical tree fingerprint

#### Scenario: Setting one property does not reorder the rest

- **WHEN** a control's `w:showingPlcHdr` is cleared by an edit
- **THEN** every other property keeps its schema position and no property is duplicated or dropped

#### Scenario: Control with no type element

- **WHEN** a control declares no type element, as seven controls in the comprehensive fixture do
- **THEN** it is typed as an untyped control — a rich-text container — rather than being assigned a type it does not declare

#### Scenario: Unmodelled property survives

- **WHEN** `w:sdtPr` contains a `w15:*` or other element outside this vocabulary
- **THEN** it is preserved as a generic child in its original position

### Requirement: Type-specific payloads are typed where they carry data

`CT_SdtDropDownList` and `CT_SdtComboBox` SHALL type their `w:listItem` children and `@w:lastValue`. `CT_SdtDate` SHALL type `w:dateFormat`, `w:lid`, `w:storeMappedDataAs`, `w:calendar`, and `@w:fullDate`. `CT_SdtText` SHALL type `@w:multiLine`. `CT_DataBinding` SHALL type `@w:xpath`, `@w:storeItemID`, and `@w:prefixMappings`.

#### Scenario: Dropdown items are readable

- **WHEN** a dropdown declares `w:listItem` children
- **THEN** their display text and values are readable without walking generic nodes

#### Scenario: Date configuration is readable

- **WHEN** a date control declares `w:dateFormat`, `w:lid`, `w:storeMappedDataAs`, and `w:calendar`, as all three date controls in the fixture do
- **THEN** each is typed, and an unedited round trip matches by canonical fingerprint

#### Scenario: `w14:checkbox` is typed as an extension, not as an ECMA-376 type

- **WHEN** a control declares the Microsoft `w14:checkbox` element
- **THEN** it is typed as a vendor extension and is distinguishable from the ECMA-376 type elements

#### Scenario: The checkbox extension is read before a control is called untyped

- **WHEN** a control declares `w14:checkbox` and no ECMA-376 type element, as the comprehensive fixture's four inline checkbox controls do
- **THEN** it is reported as a checkbox control, not as an untyped rich-text container
- **AND** its `w14:checked`, `w14:checkedState`, and `w14:uncheckedState` glyph and font are typed

#### Scenario: A bare symbol with no checkbox extension is not a checkbox

- **WHEN** an inline control wraps a `w:sym` and declares neither a type element nor `w14:checkbox`
- **THEN** it is an untyped control and no checkbox widget is offered for it

### Requirement: Data binding is preserved and not resolved

`w:dataBinding` SHALL be typed and round-tripped. This change SHALL NOT resolve an XPath against a custom XML part, SHALL NOT write a bound value back to a data store, and SHALL NOT fetch anything named by `@w:storeItemID` or `@w:prefixMappings`.

#### Scenario: Bound control round-trips

- **WHEN** a control declares `w:dataBinding`
- **THEN** it is preserved by canonical fingerprint on an unedited round trip

#### Scenario: Editing a bound control is refused, not silently divergent

- **WHEN** an operation sets the value of a control declaring `w:dataBinding`
- **THEN** it is refused with `bound`
- **AND** the control's content and its binding stay consistent with the file as loaded

#### Scenario: No fetch from binding metadata

- **WHEN** a document containing a bound control is loaded, laid out, painted, and saved
- **THEN** no network or filesystem request is made on account of the binding

### Requirement: Control identity is stable across edits

Each control SHALL carry a stable node identity independent of `w:id`, since `w:id` is optional — five controls in the comprehensive fixture omit it — and is not guaranteed unique. `w:id` SHALL be preserved where present and SHALL NOT be fabricated where absent.

#### Scenario: Control without `w:id`

- **WHEN** a control declares no `w:id`
- **THEN** it is addressable by node identity, and saving does not add a `w:id`

#### Scenario: Identity survives an edit inside the control

- **WHEN** text inside a control is edited
- **THEN** the control's node identity is unchanged, so the `ModelChange` reports the paragraph dirty rather than the control recreated

#### Scenario: Duplicate `w:id` values

- **WHEN** two controls declare the same `w:id`
- **THEN** both load, both are separately addressable, and neither is dropped or merged

### Requirement: Typed value operations per control type

`TreeDocOp` SHALL include set-content-control-value, addressed by control identity, with a value shape determined by the control's type. Each SHALL validate before committing.

#### Scenario: Dropdown accepts only its own items

- **WHEN** a value not among a dropdown's `w:listItem` values is set
- **THEN** it is refused with `invalidArgs` and no `ModelChange` is published

#### Scenario: Combo box accepts a free value

- **WHEN** a value outside the declared items is set on a combo box
- **THEN** it is accepted, because free entry is what distinguishes a combo box from a dropdown

#### Scenario: Date writes both the value and the display

- **WHEN** a date is set on a date control
- **THEN** `@w:fullDate` receives the ISO value and the control's content receives the text formatted per `w:dateFormat` and `w:lid`

#### Scenario: Type mismatch is refused

- **WHEN** a checkbox toggle is applied to a date control
- **THEN** it is refused with `typeMismatch`

#### Scenario: Value operations are one history entry

- **WHEN** a value is set through a widget
- **THEN** the property change and the content change commit in one transaction, producing one `ModelChange` and one D10 history entry

### Requirement: Controls satisfy both D9 oracles

Parts containing content controls SHALL pass the canonical tree fingerprint on an unedited round trip and the save/reopen semantic digest after an edit, including the preserved-generic comparison for unmodelled `w:sdtPr` children.

#### Scenario: Seventeen controls survive an unrelated edit

- **WHEN** the comprehensive fixture is loaded, a body paragraph outside every control is edited, and the package is saved
- **THEN** `word/document.xml` matches its input by canonical fingerprint for all seventeen control subtrees

#### Scenario: Edited control reopens equivalent

- **WHEN** a dropdown's value is set, the package is saved and reopened
- **THEN** the digest reports that control's type, items, tag, alias, lock, and new value as equivalent, and every other control unchanged

### Requirement: Content-control identifiers are allocated inside the range Word accepts

`CT_SdtPr/w:id` is `CT_DecimalNumber`, whose `@w:val` is `ST_DecimalNumber` — `xsd:integer`, unbounded in the schema — while Word treats it as a signed 32-bit integer. Where this change writes a `w:id`, it SHALL seed from the maximum control id already present in the document, plus one, clamped to signed 32-bit, and SHALL NOT derive one from a clock, timestamp, random source, or hash.

`w:id` remains optional and SHALL NOT be fabricated for a control that does not declare one; five controls in the comprehensive fixture omit it and must round-trip without gaining one.

#### Scenario: Seeded from the document

- **WHEN** a control is created in a document whose highest control id is 90210
- **THEN** the allocated id is 90211, not a clock-derived value

#### Scenario: Exported ids stay inside signed 32-bit

- **WHEN** a package containing an engine-authored control is saved and opened in Word
- **THEN** it opens without a repair prompt
- **AND** a conformance test asserts the bound directly

#### Scenario: Absent id is not fabricated

- **WHEN** a control declaring no `w:id` is loaded, edited, and saved
- **THEN** no `w:id` is added
