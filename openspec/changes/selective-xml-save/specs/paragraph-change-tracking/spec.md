## ADDED Requirements

### Requirement: Track changed paragraph IDs via ProseMirror plugin

The system SHALL provide a ProseMirror plugin that monitors transactions and records the `paraId` of every paragraph node whose content or attributes were modified since the last save (or since document load).

#### Scenario: Single paragraph text edit

- **WHEN** user types a character in a paragraph with `paraId="ABC123"`
- **THEN** the change tracker's set of changed IDs contains `"ABC123"`

#### Scenario: Formatting change to a paragraph

- **WHEN** user applies bold formatting to text within a paragraph with `paraId="DEF456"`
- **THEN** the change tracker's set of changed IDs contains `"DEF456"`

#### Scenario: Multiple paragraphs edited

- **WHEN** user selects text spanning paragraphs with `paraId="P1"` and `paraId="P2"` and applies italic
- **THEN** the change tracker's set of changed IDs contains both `"P1"` and `"P2"`

#### Scenario: Editing a paragraph with no paraId

- **WHEN** user edits a paragraph that has no `paraId` attribute (null/undefined)
- **THEN** the change tracker records a flag indicating that an untracked paragraph was modified

#### Scenario: No edits made

- **WHEN** user opens a document and does not make any changes
- **THEN** the change tracker's set of changed IDs is empty

### Requirement: Clear tracked changes on save

The change tracker SHALL provide a method to clear the set of tracked paragraph IDs, which MUST be called after a successful save.

#### Scenario: Tracked changes cleared after save

- **WHEN** a save completes successfully and `clearTrackedChanges()` is called
- **THEN** the change tracker's set of changed IDs is empty
- **AND** subsequent edits start accumulating from a clean state

### Requirement: Detect structural changes that prevent selective save

The change tracker SHALL detect when paragraphs are added or deleted (not just modified), as these changes cannot be handled by selective XML patching.

#### Scenario: Paragraph added via Enter key

- **WHEN** user presses Enter to split a paragraph, creating a new paragraph node
- **THEN** the change tracker records that a structural change occurred (paragraph count changed)

#### Scenario: Paragraph deleted via Backspace at start

- **WHEN** user presses Backspace at the start of a paragraph, merging it with the previous one
- **THEN** the change tracker records that a structural change occurred (paragraph count changed)

#### Scenario: Content-only edits preserve structure

- **WHEN** user only edits text/formatting within existing paragraphs (no splits or merges)
- **THEN** the change tracker does NOT report a structural change

### Requirement: Expose change tracking state via API

The change tracker SHALL expose its state so the save flow can query it.

#### Scenario: Query changed paragraph IDs

- **WHEN** the save flow calls `getChangedParagraphIds()`
- **THEN** it receives a `Set<string>` of all paragraph IDs modified since last save/load

#### Scenario: Query whether structural changes occurred

- **WHEN** the save flow calls `hasStructuralChanges()`
- **THEN** it receives `true` if paragraphs were added/deleted, `false` otherwise
