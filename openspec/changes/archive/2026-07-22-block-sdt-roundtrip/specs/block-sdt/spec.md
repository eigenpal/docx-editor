# block-sdt Spec

## ADDED Requirements

### Requirement: Block-level SDTs are preserved through parse

The parser SHALL emit a `BlockSdt` node for each block-level `w:sdt` element, wrapping the parsed block children and capturing its `w:sdtPr`. It SHALL NOT flatten the wrapper into the parent block stream. `BlockSdt.content` SHALL be `BlockContent[]` so nested block SDTs and run-level/bookmark content inside `w:sdtContent` are not dropped.

#### Scenario: A block SDT wrapping a paragraph is parsed

- **Given** a DOCX body containing a `w:sdt` whose `w:sdtContent` holds a single `w:p`
- **When** the document is parsed
- **Then** the body content contains one `BlockSdt` whose `content` is the parsed paragraph
- **And** no bare paragraph is emitted in place of the wrapper

#### Scenario: A block SDT wrapping a table is parsed

- **Given** a `w:sdt` whose `w:sdtContent` holds a `w:tbl`
- **When** the document is parsed
- **Then** a `BlockSdt` is emitted whose `content` is the parsed table

#### Scenario: A block SDT wrapping multiple children is parsed

- **Given** a `w:sdt` whose `w:sdtContent` holds two `w:p` and a `w:tbl`
- **When** parsed
- **Then** the `BlockSdt.content` has all three in document order

#### Scenario: A nested block SDT is preserved

- **Given** a block `w:sdt` whose `w:sdtContent` contains another block `w:sdt`
- **When** parsed
- **Then** the outer `BlockSdt.content` contains an inner `BlockSdt`

#### Scenario: Bookmarks inside sdtContent survive

- **Given** a block `w:sdt` wrapping a paragraph bracketed by `w:bookmarkStart`/`w:bookmarkEnd`
- **When** parsed and re-serialized
- **Then** the bookmarks are present in the output

#### Scenario: Empty or absent sdtContent does not throw

- **Given** a `w:sdt` with no `w:sdtContent` (or an empty one)
- **When** parsed
- **Then** a `BlockSdt` with empty `content` is produced and re-serialized without error

#### Scenario: SDT properties are projected

- **Given** a block `w:sdt` with `w:alias`, `w:tag`, `w:id`, `w:lock`, and `w:placeholder/w:docPart` in its `w:sdtPr`
- **When** parsed
- **Then** `BlockSdt.properties` projects `alias`, `tag`, `id`, `lock`, and the placeholder docPart name
- **And** the control type defaults to `richText` only when no type marker is present, and is `unknown` for a type marker the editor does not model

### Requirement: Block-level SDTs round-trip losslessly on save

The serializer SHALL write a `w:sdt` for each `BlockSdt`, re-emitting the captured raw `w:sdtPr` (and `w:sdtEndPr`) verbatim and serializing the child blocks inside `w:sdtContent`. It SHALL NOT reconstruct `w:sdtPr` from the modeled projection when a raw capture exists. A parse→serialize cycle SHALL preserve block content controls and their properties.

#### Scenario: Round-trip preserves the wrapper and identity

- **Given** a DOCX with a block-level content control addressed by `w:tag`
- **When** it is parsed and re-serialized without edits
- **Then** the output contains a `w:sdt` wrapping the same content with the same `w:tag`, `w:alias`, and `w:id`

#### Scenario: sdtPr child ordering stays valid

- **Given** a block `w:sdt` whose `w:sdtPr` contains `w:alias`, `w:dataBinding`, and a `w:comboBox` type marker in schema order
- **When** re-serialized
- **Then** the `w:sdtPr` children appear in valid `CT_SdtPr` sequence order
- **And** no element appears after the type-marker choice

#### Scenario: No duplicate elements

- **Given** a block `w:sdt` with an explicit `w:lock`
- **When** re-serialized
- **Then** exactly one `w:lock` element is present in the output `w:sdtPr`

#### Scenario: Unmodeled type marker is preserved, not substituted

- **Given** a block `w:sdt` with a `w:bibliography` (or `w:group`, or `w14:checkbox`) type marker
- **When** round-tripped
- **Then** the same single type marker is present
- **And** no `w:richText` is substituted for it

#### Scenario: Unmodeled sdtPr features survive byte-faithfully

- **Given** a block `w:sdt` whose `w:sdtPr` contains a `w:dataBinding` with `xpath`, `storeItemID`, and `prefixMappings`
- **When** parsed and re-serialized
- **Then** that `w:dataBinding` is present unchanged, with all three attributes

#### Scenario: dropDownList items and lastValue round-trip

- **Given** a block `w:sdt` with a `w:dropDownList` carrying `@lastValue` and several `w:listItem` (each with `displayText` and `value`)
- **When** round-tripped
- **Then** the list items and `@lastValue` are preserved

#### Scenario: sdtEndPr is preserved

- **Given** a block `w:sdt` with a `w:sdtEndPr` containing `w:rPr`
- **When** round-tripped
- **Then** the `w:sdtEndPr` survives in the output

### Requirement: Inline and block SDTs share property parsing without serializer regression

Inline and block SDT parsing SHALL use a single shared properties parser so the read-side projection cannot diverge. The existing inline serializer behavior SHALL be preserved.

#### Scenario: Inline SDT serialization is unchanged

- **Given** the existing inline SDT round-trip fixtures
- **When** the shared parser is adopted
- **Then** previously-asserted inline output (fields, nested SDTs, math, list items, date, checkbox) is preserved
