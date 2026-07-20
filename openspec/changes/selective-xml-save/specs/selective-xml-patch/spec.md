## ADDED Requirements

### Requirement: Find paragraph offsets in original XML by paraId

The system SHALL locate the exact string start and end offsets of `<w:p>` elements in the original `document.xml` string, identified by their `w14:paraId` attribute.

#### Scenario: Find a paragraph by paraId

- **WHEN** `findParagraphOffsets(originalXml, "ABC123")` is called
- **AND** the original XML contains `<w:p w14:paraId="ABC123" ...>...</w:p>`
- **THEN** it returns `{ start, end }` where `originalXml.substring(start, end)` equals the full `<w:p>...</w:p>` element

#### Scenario: paraId not found in original XML

- **WHEN** `findParagraphOffsets(originalXml, "MISSING")` is called
- **AND** no `<w:p>` element has `w14:paraId="MISSING"`
- **THEN** it returns `null`

#### Scenario: Nested w:p inside mc:AlternateContent

- **WHEN** original XML contains `<mc:AlternateContent>` with nested `<w:p>` elements
- **AND** the target `paraId` belongs to the outer `<w:p>` wrapping the `<mc:AlternateContent>`
- **THEN** the returned offsets encompass the entire outer `<w:p>` including all nested content

#### Scenario: Duplicate paraId in document

- **WHEN** the original XML contains two `<w:p>` elements with the same `w14:paraId`
- **THEN** the function returns `null` (ambiguous — cannot safely patch)

### Requirement: Extract serialized paragraph XML from full serialization

The system SHALL extract the serialized XML for a specific paragraph (by `paraId`) from the fully serialized `document.xml`.

#### Scenario: Extract changed paragraph XML

- **WHEN** the full serialized `document.xml` is produced via `serializeDocument()`
- **AND** `extractParagraphXml(serializedXml, "ABC123")` is called
- **THEN** it returns the complete `<w:p w14:paraId="ABC123" ...>...</w:p>` string from the serialized output

#### Scenario: paraId not in serialized output

- **WHEN** the paragraph was deleted from the document model
- **AND** `extractParagraphXml(serializedXml, "DELETED")` is called
- **THEN** it returns `null`

### Requirement: Build patched document.xml from selective replacements

The system SHALL produce a patched `document.xml` string by splicing new paragraph XML into the original XML at the correct offsets, preserving all unchanged content byte-for-byte.

#### Scenario: Single paragraph replaced

- **WHEN** paragraph `"P1"` was modified
- **AND** the original XML and new paragraph XML for `"P1"` are provided
- **THEN** the patched XML is identical to the original EXCEPT the `<w:p>` element for `"P1"` which contains the new serialized content

#### Scenario: Multiple paragraphs replaced

- **WHEN** paragraphs `"P1"` and `"P3"` were modified (with `"P2"` unchanged between them)
- **THEN** the patched XML preserves `"P2"` and all surrounding XML byte-for-byte
- **AND** only `"P1"` and `"P3"` contain new serialized content

#### Scenario: Patches applied without offset corruption

- **WHEN** multiple paragraphs are patched and the new XML for each is a different length than the original
- **THEN** all replacements are correct (no shifted or overlapping offsets)

### Requirement: Validate patch safety before applying

The system SHALL validate that a selective patch can be safely applied before producing the patched XML.

#### Scenario: All changed paraIds found in original

- **WHEN** every `paraId` in the changed set exists exactly once in the original XML
- **AND** every `paraId` in the changed set exists in the serialized output
- **THEN** the patch is considered safe to apply

#### Scenario: Changed paraId missing from original XML

- **WHEN** a changed `paraId` cannot be found in the original XML
- **THEN** the patch is NOT safe (return a reason: `"paraId-not-found-in-original"`)

#### Scenario: Changed paraId missing from serialized output

- **WHEN** a changed `paraId` exists in the original but not in the serialized output
- **THEN** the patch is NOT safe (return a reason: `"paraId-not-found-in-serialized"`)

#### Scenario: Paragraph count mismatch

- **WHEN** the count of `<w:p>` elements in the original XML differs from the serialized XML
- **THEN** the patch is NOT safe (return a reason: `"paragraph-count-mismatch"`)
