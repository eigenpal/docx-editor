## ADDED Requirements

### Requirement: Selective save integrated into DocxEditor save flow

The `DocxEditor.handleSave()` flow SHALL attempt selective XML patching before falling back to full repack. This MUST be transparent to the caller — the returned buffer is a valid DOCX regardless of which path was taken.

#### Scenario: Small edit uses selective save

- **WHEN** user edits text in one paragraph and saves
- **AND** no structural changes occurred (no paragraphs added/deleted)
- **AND** the original buffer is available
- **THEN** the save produces a DOCX where unchanged paragraphs in `document.xml` are byte-for-byte identical to the original

#### Scenario: Structural change falls back to full repack

- **WHEN** user adds a new paragraph (e.g., presses Enter) and saves
- **THEN** the save falls back to full repack via `repackDocx()`
- **AND** the returned DOCX is valid

#### Scenario: New image falls back to full repack

- **WHEN** user inserts a new image (data URL, no rId) and saves
- **THEN** the save falls back to full repack (images need relationship management)
- **AND** the returned DOCX is valid

#### Scenario: New hyperlink falls back to full repack

- **WHEN** user inserts a new hyperlink (href, no rId) and saves
- **THEN** the save falls back to full repack (hyperlinks need relationship management)
- **AND** the returned DOCX is valid

#### Scenario: No original buffer falls back to full repack

- **WHEN** the document was created from scratch (no `originalBuffer`)
- **THEN** the save falls back to full repack
- **AND** the returned DOCX is valid

#### Scenario: Patch validation failure falls back to full repack

- **WHEN** the selective XML patch fails validation (e.g., paraId not found, count mismatch)
- **THEN** the save falls back to full repack
- **AND** the returned DOCX is valid

#### Scenario: No changes made uses selective save (no-op)

- **WHEN** user opens a document, makes no changes, and saves
- **THEN** the save produces a DOCX that is identical (or near-identical) to the original
- **AND** `document.xml` is byte-for-byte preserved

### Requirement: Selective save option on save API

The `save()` method SHALL accept an optional `selective` parameter (default: `true`) that controls whether selective XML patching is attempted.

#### Scenario: Selective save enabled (default)

- **WHEN** `save()` is called without arguments or with `{ selective: true }`
- **THEN** the save flow attempts selective XML patching before falling back

#### Scenario: Selective save disabled

- **WHEN** `save({ selective: false })` is called
- **THEN** the save flow always uses full repack, skipping selective patching

### Requirement: Selective save handles headers/footers via full repack of those parts

When headers or footers are modified, the save flow SHALL re-serialize those parts fully (existing behavior) while still using selective patching for `document.xml` if applicable.

#### Scenario: Header edited, body paragraph edited

- **WHEN** user edits a header and also edits a body paragraph
- **THEN** `document.xml` is selectively patched (only the changed body paragraph)
- **AND** the header XML part is fully re-serialized (existing behavior)
- **AND** all other XML parts are unchanged

### Requirement: Change tracker cleared after successful save

After a successful save (regardless of whether selective or full repack was used), the paragraph change tracker MUST be cleared so subsequent saves only track new changes.

#### Scenario: Tracker reset after save

- **WHEN** a save completes successfully
- **THEN** the change tracker's changed paragraph set is empty
- **AND** subsequent edits start accumulating fresh

#### Scenario: Tracker NOT cleared on save error

- **WHEN** a save fails (e.g., ZIP generation error)
- **THEN** the change tracker retains its state
- **AND** the next save attempt can still use the tracked changes

### Requirement: Round-trip correctness preserved

Selective save MUST produce DOCX files that round-trip correctly — opening the saved file in the editor MUST produce the same content as before saving.

#### Scenario: Edit, save, reopen produces same content

- **WHEN** user edits a paragraph, saves, and reopens the saved file
- **THEN** all paragraphs (both changed and unchanged) display correctly
- **AND** formatting, styles, and structure are preserved

#### Scenario: Multiple save cycles maintain correctness

- **WHEN** user edits paragraph A, saves, then edits paragraph B, saves again
- **THEN** both paragraphs A and B reflect their latest edits
- **AND** all unchanged paragraphs remain byte-for-byte identical to the original
