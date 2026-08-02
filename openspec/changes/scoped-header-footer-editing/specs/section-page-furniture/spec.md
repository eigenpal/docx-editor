## ADDED Requirements

### Requirement: Header and footer references resolve per section

Header and footer references SHALL be resolved for every section the document declares, including sections whose `w:sectPr` appears inside a paragraph's `w:pPr` rather than as a child of `w:body`. Resolution SHALL NOT read a single document-global `w:sectPr`.

#### Scenario: Mid-body sections resolve their own parts

- **WHEN** the comprehensive fixture — five sections, four declaring their properties mid-body — is loaded
- **THEN** each section resolves the parts its own `w:sectPr` names
- **AND** section 2 resolves `rId6` / `rId7`, section 4 resolves `rId10` / `rId11`, and no section is given another section's part by default

#### Scenario: Final body-level section still resolves

- **WHEN** the document's last section declares its properties as a `w:sectPr` child of `w:body`
- **THEN** it resolves normally, as it does today

#### Scenario: Dangling relationship id stays fail-open

- **WHEN** a section's `w:headerReference` names an `r:id` that does not resolve to an internal header part
- **THEN** that section renders no header and the document still loads

#### Scenario: Duplicate reference of one type

- **WHEN** a section declares two `w:headerReference` elements with `w:type="default"`
- **THEN** the first wins and the second is ignored, matching Word

### Requirement: Sections inherit page furniture from the preceding section

A section declaring no reference for a needed kind and variant SHALL use what the preceding section resolves to for that kind and variant. The first section has no predecessor: declaring none renders that region empty.

#### Scenario: Inheritance chain

- **WHEN** section 2 declares a default header and section 3 declares none
- **THEN** pages in section 3 render section 2's header

#### Scenario: First section with no reference renders empty

- **WHEN** the document's first section declares neither `w:headerReference` nor `w:footerReference`, as the comprehensive fixture's first section does
- **THEN** its pages render an empty header and an empty footer
- **AND** they do NOT render a later section's header

#### Scenario: Inheritance is per kind and per variant

- **WHEN** a section declares a footer but no header
- **THEN** it uses its own footer and the inherited header

#### Scenario: Resolution reports inheritance

- **WHEN** a caller asks which part applies to a page in a section that declares none
- **THEN** the result names the resolved part and reports that it is inherited

### Requirement: Variant selection is section-relative for `first` and document-scoped for `even`

The `first` variant SHALL apply to the first page **of its own section** when that section sets `w:titlePg`. The `even` variant SHALL apply when `w:evenAndOddHeaders` is set in `w:settings`, evaluated against the displayed page number. An absent variant SHALL render blank rather than falling back to `default`.

#### Scenario: titlePg in a later section

- **WHEN** section 3 sets `w:titlePg` and declares a `first` header, and section 3 begins on document page 7
- **THEN** page 7 uses the `first` header and pages 8 onward in that section use `default`
- **AND** document page 1 is unaffected by section 3's `w:titlePg`

#### Scenario: titlePg is per section, not global

- **WHEN** one section sets `w:titlePg` and another does not
- **THEN** only the setting section's first page takes the `first` variant

#### Scenario: titlePg with no first-page part

- **WHEN** a section sets `w:titlePg` but declares no `first` reference and inherits none
- **THEN** its first page renders an empty header, not the `default` header

#### Scenario: evenAndOddHeaders disabled

- **WHEN** settings carry `<w:evenAndOddHeaders w:val="false"/>`, as the comprehensive fixture does
- **THEN** even pages use `default` even where an `even` reference exists

#### Scenario: evenAndOddHeaders enabled

- **WHEN** `w:evenAndOddHeaders` is set and a section declares both `default` and `even`
- **THEN** odd displayed pages use `default` and even displayed pages use `even`

### Requirement: Section geometry carries distances, page numbering, and column separator

`SectionProperties` SHALL carry `headerDistanceTwips` and `footerDistanceTwips` from `w:pgMar/@w:header` and `@w:footer`, `pageNumbering` from `w:pgNumType`, and a `separator` flag on columns from `w:cols/@w:sep`.

#### Scenario: Header distance drives placement

- **WHEN** `w:pgMar/@w:header="708"` and `@w:top="1440"`
- **THEN** the header story's box starts 708 twips from the page's top edge and the body content area starts 1440 twips from it

#### Scenario: Furniture taller than its margin pushes the body

- **WHEN** a header story's flow height exceeds the space between `@w:header` and `@w:top`
- **THEN** the body content area starts lower so the header is not clipped and does not overlap body text
- **AND** the box is sized by the story's flow height, never by an anchored object's extent

#### Scenario: Empty pgNumType round-trips as empty

- **WHEN** a section carries `<w:pgNumType/>` with no attributes, as all five sections in the comprehensive fixture do
- **THEN** no authored page-numbering value is reported
- **AND** serializing the unedited section re-emits an empty `w:pgNumType` — neither dropped nor populated with defaults

#### Scenario: Restarted page numbering

- **WHEN** a section sets `w:pgNumType w:start="1"`
- **THEN** displayed page numbers restart at 1 for that section

#### Scenario: Column separator

- **WHEN** a section sets `w:cols w:num="2" w:sep="true"`
- **THEN** a vertical rule is drawn between the columns

### Requirement: The treatment of a literal tab character is decided once, against Word

A `w:tab` node SHALL advance to the next tab stop. The treatment of U+0009 inside `w:t` is **not decided by ECMA-376** and SHALL be settled by comparison against Word, recorded as evidence, and then applied uniformly to every story. It SHALL NOT be inferred independently per renderer or per part.

#### Scenario: The rule is uniform across every affected part

- **WHEN** the settled rule is applied
- **THEN** it holds identically for all five affected parts of the comprehensive fixture — `header1`, `header4`, `footer1`, `footer2`, `footer3` — and for the body
- **AND** the literal character round-trips unchanged either way

#### Scenario: Evidence is recorded, not assumed

- **WHEN** the rule is implemented
- **THEN** the Word comparison that decided it is recorded with the change
- **AND** no test asserts a tab advance, or its absence, on the basis of the schema alone

#### Scenario: Real tab element in a header

- **WHEN** the same paragraph uses a `w:tab` node instead
- **THEN** the following run starts at the declared right tab stop

### Requirement: Furniture lifecycle operations commit through the store

`TreeDocOp` SHALL include create-header-footer, delete-header-footer, link-to-previous, unlink-from-previous, and set-section-furniture-options. Each SHALL validate and commit atomically, publishing one `ModelChange` with an impact class no narrower than `flow-structural`.

#### Scenario: Create allocates part, override, and relationship

- **WHEN** create-header-footer runs for a section with no header
- **THEN** a new header part, a `[Content_Types].xml` override, a relationship, and the section's `w:headerReference` are added in one transaction
- **AND** the new part name does not collide with an existing part

#### Scenario: Unlink clones rather than shares

- **WHEN** a section inherits its header and unlink-from-previous runs
- **THEN** a new part holding a copy of the inherited content is created and the section gains its own reference
- **AND** editing the new part does not change the previous section's pages

#### Scenario: Link garbage-collects an orphan

- **WHEN** link-to-previous removes a section's only reference to a part and no other section references it
- **THEN** the part, its relationship, and its content-type override are removed in the same transaction

#### Scenario: Link on the first section is refused

- **WHEN** link-to-previous targets the first section
- **THEN** it is refused with `invalidArgs` and no `ModelChange` is published

#### Scenario: evenAndOddHeaders is written document-wide

- **WHEN** set-section-furniture-options enables odd-and-even headers
- **THEN** `w:evenAndOddHeaders` is written to `w:settings`, because the setting has no per-section form

### Requirement: Header and footer parts satisfy both D9 oracles

Header and footer parts SHALL pass the canonical tree fingerprint on an unedited round trip and the save/reopen semantic digest after an edit.

#### Scenario: Unedited save

- **WHEN** a document is loaded, a body paragraph is edited, and the package is saved
- **THEN** every header and footer part matches its input by canonical fingerprint

#### Scenario: One edited part, seven untouched

- **WHEN** one of eight header/footer parts is edited and saved
- **THEN** only that part differs by fingerprint, and the reopened digest reports the other seven as unchanged
