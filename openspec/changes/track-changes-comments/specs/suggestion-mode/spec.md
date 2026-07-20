## ADDED Requirements

### Requirement: Suggestion mode toggle

The system SHALL provide a mode toggle that switches between "Editing" mode (normal editing) and "Suggesting" mode (all edits become tracked changes).

#### Scenario: Toggle to suggestion mode via toolbar

- **WHEN** the user clicks the editing mode dropdown in the toolbar and selects "Suggesting"
- **THEN** the editor SHALL enter suggestion mode, the toolbar SHALL display "Suggesting" as the active mode, and a visual indicator SHALL show that suggestion mode is active

#### Scenario: Toggle to suggestion mode via keyboard

- **WHEN** the user presses Ctrl+Shift+E (or Cmd+Shift+E on Mac)
- **THEN** the editor SHALL toggle between Editing and Suggesting modes

#### Scenario: Return to editing mode

- **WHEN** the user selects "Editing" from the mode dropdown
- **THEN** the editor SHALL return to normal editing mode where edits directly modify the document

### Requirement: Text insertion tracking

In suggestion mode, the system SHALL track all text insertions as tracked changes with author and timestamp metadata.

#### Scenario: Type new text in suggestion mode

- **WHEN** the user types text while in suggestion mode
- **THEN** the typed text SHALL be wrapped in an insertion mark with green underline styling, and metadata SHALL include the current author name and timestamp

#### Scenario: Paste text in suggestion mode

- **WHEN** the user pastes text while in suggestion mode
- **THEN** all pasted text SHALL be wrapped in an insertion mark with the same styling and metadata as typed text

### Requirement: Text deletion tracking

In suggestion mode, the system SHALL track all text deletions as tracked changes instead of removing the text.

#### Scenario: Delete text with Backspace in suggestion mode

- **WHEN** the user presses Backspace while in suggestion mode
- **THEN** the character before the cursor SHALL NOT be removed from the document but SHALL be wrapped in a deletion mark with red strikethrough styling and metadata

#### Scenario: Delete selected text in suggestion mode

- **WHEN** the user selects text and presses Delete or Backspace in suggestion mode
- **THEN** the selected text SHALL NOT be removed but SHALL be wrapped in a deletion mark with red strikethrough styling

#### Scenario: Replace selected text in suggestion mode

- **WHEN** the user selects text and types replacement text in suggestion mode
- **THEN** the original text SHALL be marked as a deletion and the new text SHALL be marked as an insertion, appearing adjacent in the document

### Requirement: Suggestion mode visual indicators

The system SHALL provide clear visual feedback when suggestion mode is active.

#### Scenario: Insertion styling

- **WHEN** text is marked as an insertion
- **THEN** the text SHALL be displayed with a green color and underline decoration

#### Scenario: Deletion styling

- **WHEN** text is marked as a deletion
- **THEN** the text SHALL be displayed with a red color and strikethrough decoration

#### Scenario: Mode indicator in toolbar

- **WHEN** suggestion mode is active
- **THEN** the toolbar SHALL display a visible indicator (e.g., colored badge or icon) showing the current mode

### Requirement: Suggestion metadata

Each tracked change SHALL include metadata identifying the author and time of the change.

#### Scenario: Author attribution

- **WHEN** a tracked change is created in suggestion mode
- **THEN** the change SHALL store the author name configured in editor settings

#### Scenario: Timestamp recording

- **WHEN** a tracked change is created in suggestion mode
- **THEN** the change SHALL store the current date and time

### Requirement: Tracked changes DOCX round-trip

The system SHALL preserve tracked changes when saving to DOCX format using standard revision markup.

#### Scenario: Save document with tracked changes

- **WHEN** the user saves a document containing tracked insertions and deletions
- **THEN** the tracked changes SHALL be serialized using OOXML revision markup (`w:ins`, `w:del` elements) with author and date attributes

#### Scenario: Load DOCX with existing tracked changes

- **WHEN** a DOCX file with existing tracked changes is loaded
- **THEN** insertions and deletions SHALL be displayed with their correct styling and metadata in the editor
