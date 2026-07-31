## ADDED Requirements

### Requirement: Accept individual tracked change

The system SHALL allow users to accept a single tracked change, applying it to the document as a permanent edit.

#### Scenario: Accept an insertion

- **WHEN** the user clicks "Accept" on a tracked insertion
- **THEN** the insertion mark SHALL be removed and the text SHALL remain in the document as normal (unmarked) text

#### Scenario: Accept a deletion

- **WHEN** the user clicks "Accept" on a tracked deletion
- **THEN** the deletion mark and the marked text SHALL both be removed from the document

#### Scenario: Accept change at cursor

- **WHEN** the cursor is positioned within a tracked change and the user clicks "Accept" in the toolbar
- **THEN** the tracked change containing the cursor SHALL be accepted

### Requirement: Reject individual tracked change

The system SHALL allow users to reject a single tracked change, reverting it.

#### Scenario: Reject an insertion

- **WHEN** the user clicks "Reject" on a tracked insertion
- **THEN** the insertion mark and the inserted text SHALL both be removed from the document

#### Scenario: Reject a deletion

- **WHEN** the user clicks "Reject" on a tracked deletion
- **THEN** the deletion mark SHALL be removed and the text SHALL remain in the document as normal text

#### Scenario: Reject change at cursor

- **WHEN** the cursor is positioned within a tracked change and the user clicks "Reject" in the toolbar
- **THEN** the tracked change containing the cursor SHALL be rejected

### Requirement: Accept all tracked changes

The system SHALL allow users to accept all tracked changes in the document at once.

#### Scenario: Accept all changes

- **WHEN** the user clicks "Accept All" in the toolbar or review panel
- **THEN** all insertion marks SHALL be removed (keeping text) and all deletion marks with their text SHALL be removed, in a single undoable operation

#### Scenario: Accept all with empty result

- **WHEN** there are no tracked changes in the document and the user clicks "Accept All"
- **THEN** the operation SHALL be a no-op with no error

### Requirement: Reject all tracked changes

The system SHALL allow users to reject all tracked changes in the document at once.

#### Scenario: Reject all changes

- **WHEN** the user clicks "Reject All" in the toolbar or review panel
- **THEN** all insertion marks with their text SHALL be removed and all deletion marks SHALL be removed (keeping text), in a single undoable operation

### Requirement: Navigate between tracked changes

The system SHALL allow users to navigate forward and backward through tracked changes in document order.

#### Scenario: Next change

- **WHEN** the user clicks "Next Change" or presses the navigation shortcut
- **THEN** the cursor SHALL move to the next tracked change after the current position, selecting the changed text range

#### Scenario: Previous change

- **WHEN** the user clicks "Previous Change" or presses the navigation shortcut
- **THEN** the cursor SHALL move to the previous tracked change before the current position, selecting the changed text range

#### Scenario: Wrap around

- **WHEN** the user navigates past the last (or before the first) tracked change
- **THEN** navigation SHALL wrap to the beginning (or end) of the document

### Requirement: Tracked changes in sidebar

Tracked changes SHALL be displayed in the comments/changes sidebar alongside comments, in document order.

#### Scenario: Display tracked changes in sidebar

- **WHEN** the document contains tracked changes
- **THEN** each tracked change SHALL appear as a card in the sidebar showing: the change type (insertion/deletion), the changed text preview, author, and date

#### Scenario: Accept/reject from sidebar

- **WHEN** the user clicks "Accept" or "Reject" on a tracked change card in the sidebar
- **THEN** the corresponding tracked change SHALL be accepted or rejected

#### Scenario: Click tracked change card to navigate

- **WHEN** the user clicks on a tracked change card in the sidebar
- **THEN** the document SHALL scroll to the tracked change and select the affected text range

### Requirement: Review toolbar controls

The system SHALL provide toolbar controls for reviewing tracked changes.

#### Scenario: Review controls visibility

- **WHEN** the document contains tracked changes
- **THEN** the toolbar SHALL display Accept, Reject, Accept All, Reject All, Previous Change, and Next Change buttons

#### Scenario: Review controls disabled state

- **WHEN** the cursor is not within a tracked change
- **THEN** the Accept and Reject buttons for individual changes SHALL be disabled, while Accept All, Reject All, and navigation buttons remain enabled
