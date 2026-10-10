## ADDED Requirements

### Requirement: Clipboard operations in context menu

The system SHALL display Cut, Copy, Paste, Paste without formatting, and Delete items in every context menu.

#### Scenario: Cut with selection

- **WHEN** user has text selected and clicks Cut in the context menu
- **THEN** the selected text is cut to clipboard and removed from the document

#### Scenario: Copy with selection

- **WHEN** user has text selected and clicks Copy in the context menu
- **THEN** the selected text is copied to clipboard

#### Scenario: Paste

- **WHEN** user clicks Paste in the context menu
- **THEN** clipboard content is pasted at the cursor position with formatting preserved

#### Scenario: Paste without formatting

- **WHEN** user clicks "Paste without formatting" in the context menu
- **THEN** clipboard content is pasted as plain text at the cursor position

#### Scenario: Delete with selection

- **WHEN** user has text selected and clicks Delete in the context menu
- **THEN** the selected text is removed from the document

#### Scenario: Cut/Copy/Delete disabled without selection

- **WHEN** no text is selected (cursor only)
- **THEN** Cut, Copy, and Delete items SHALL appear disabled

### Requirement: Keyboard shortcut hints

The system SHALL display keyboard shortcuts next to applicable menu items.

#### Scenario: Shortcut display

- **WHEN** the context menu is shown
- **THEN** Cut shows Cmd+X / Ctrl+X, Copy shows Cmd+C / Ctrl+C, Paste shows Cmd+V / Ctrl+V, Paste without formatting shows Cmd+Shift+V / Ctrl+Shift+V

### Requirement: Comment action in context menu

The system SHALL display a Comment item when text is selected.

#### Scenario: Add comment with selection

- **WHEN** user has text selected and clicks Comment in the context menu
- **THEN** the comment creation flow is triggered for the selected text

#### Scenario: Comment hidden without selection

- **WHEN** no text is selected
- **THEN** the Comment item SHALL NOT appear in the menu

### Requirement: Insert link action in context menu

The system SHALL display an "Insert link" item when text is selected.

#### Scenario: Insert link with selection

- **WHEN** user has text selected and clicks "Insert link" in the context menu
- **THEN** the hyperlink insertion dialog/flow is triggered

#### Scenario: Insert link hidden without selection

- **WHEN** no text is selected and cursor is not on an existing hyperlink
- **THEN** the "Insert link" item SHALL NOT appear in the menu

### Requirement: Clear formatting action in context menu

The system SHALL display a "Clear formatting" item when text is selected.

#### Scenario: Clear formatting with selection

- **WHEN** user has text selected and clicks "Clear formatting" in the context menu
- **THEN** all formatting marks are removed from the selected text

#### Scenario: Clear formatting hidden without selection

- **WHEN** no text is selected
- **THEN** the "Clear formatting" item SHALL NOT appear in the menu
