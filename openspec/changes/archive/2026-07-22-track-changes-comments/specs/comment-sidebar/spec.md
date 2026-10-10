## ADDED Requirements

### Requirement: Comment sidebar panel

The system SHALL display a comments sidebar panel on the right side of the editor when comments exist in the document or when the user initiates adding a comment. The sidebar SHALL show all comments anchored to their corresponding text ranges.

#### Scenario: Sidebar appears when document has comments

- **WHEN** a DOCX file with existing comments is loaded
- **THEN** the sidebar panel SHALL appear on the right side of the editor, displaying all comments

#### Scenario: Sidebar appears when user adds a comment

- **WHEN** the user selects text and clicks the "Add comment" toolbar button
- **THEN** the sidebar panel SHALL appear (if not already visible) with a new comment input focused

#### Scenario: Sidebar can be toggled

- **WHEN** the user clicks the comments toggle button in the toolbar
- **THEN** the sidebar SHALL show/hide with a smooth transition animation

### Requirement: Add comment

The system SHALL allow users to add a comment to any selected text range. The comment SHALL be anchored to the selected text and displayed in the sidebar.

#### Scenario: Add comment via toolbar

- **WHEN** the user selects text and clicks the "Add comment" button in the toolbar
- **THEN** a new comment card SHALL appear in the sidebar at the vertical position corresponding to the selected text, with an input field focused for typing the comment text

#### Scenario: Add comment via keyboard shortcut

- **WHEN** the user selects text and presses Ctrl+Alt+M (or Cmd+Alt+M on Mac)
- **THEN** the system SHALL behave identically to clicking the "Add comment" toolbar button

#### Scenario: Submit comment

- **WHEN** the user types comment text and presses Enter (or clicks Submit)
- **THEN** the comment SHALL be saved with the current author name, current timestamp, and the selected text range SHALL be highlighted with a comment indicator

#### Scenario: Cancel comment

- **WHEN** the user presses Escape or clicks Cancel while composing a new comment
- **THEN** the comment input SHALL be dismissed and no comment SHALL be created

### Requirement: Comment text highlighting

The system SHALL visually highlight text ranges that have associated comments. The highlighting SHALL be distinct and non-intrusive.

#### Scenario: Commented text is highlighted

- **WHEN** text has an associated comment
- **THEN** the text SHALL be rendered with a yellow/amber background highlight in the document

#### Scenario: Active comment highlighting

- **WHEN** the user clicks on a comment in the sidebar or clicks on highlighted text
- **THEN** the corresponding text range SHALL use a darker highlight color and the sidebar card SHALL be visually emphasized

### Requirement: Comment threading (replies)

The system SHALL support threaded replies on comments. Replies SHALL be displayed nested under their parent comment.

#### Scenario: Reply to a comment

- **WHEN** the user clicks "Reply" on an existing comment card
- **THEN** a reply input field SHALL appear below the comment, and submitting it SHALL add a threaded reply with author and timestamp

#### Scenario: Display replies

- **WHEN** a comment has replies
- **THEN** all replies SHALL be displayed in chronological order nested below the parent comment

### Requirement: Resolve and reopen comments

The system SHALL allow users to resolve and reopen comments. Resolved comments SHALL be visually distinguished.

#### Scenario: Resolve a comment

- **WHEN** the user clicks the "Resolve" button on a comment card
- **THEN** the comment SHALL be marked as resolved, the text highlight SHALL be removed or dimmed, and the comment card SHALL show a resolved state

#### Scenario: Reopen a resolved comment

- **WHEN** the user clicks "Reopen" on a resolved comment
- **THEN** the comment SHALL return to active state with full highlighting restored

#### Scenario: Toggle resolved comments visibility

- **WHEN** the user toggles "Show resolved" in the sidebar header
- **THEN** resolved comments SHALL be shown (dimmed) or hidden from the sidebar

### Requirement: Delete comment

The system SHALL allow users to delete comments. Deleting a comment SHALL remove the text highlighting and the sidebar card.

#### Scenario: Delete a comment

- **WHEN** the user clicks "Delete" on a comment's overflow menu
- **THEN** the comment, all its replies, and the associated text highlight SHALL be removed from the document

### Requirement: Leader lines

The system SHALL draw connecting lines between commented text ranges in the document and their corresponding comment cards in the sidebar.

#### Scenario: Leader line connects comment to text

- **WHEN** a comment is visible in the sidebar and its anchored text is visible on screen
- **THEN** a line SHALL be drawn from the right edge of the highlighted text to the left edge of the comment card

#### Scenario: Leader line updates on scroll

- **WHEN** the user scrolls the document
- **THEN** leader lines SHALL update their positions to maintain the connection between text and sidebar cards

#### Scenario: Active comment leader line emphasis

- **WHEN** a comment is selected/active
- **THEN** its leader line SHALL be visually emphasized (darker color or thicker line) compared to inactive leader lines

### Requirement: Comment navigation

The system SHALL allow users to navigate between comments.

#### Scenario: Click comment to scroll to text

- **WHEN** the user clicks on a comment card in the sidebar
- **THEN** the document SHALL scroll to show the commented text range, and the text SHALL be selected

#### Scenario: Click highlighted text to focus comment

- **WHEN** the user clicks on highlighted (commented) text in the document
- **THEN** the sidebar SHALL scroll to show the corresponding comment card, and the card SHALL be highlighted

### Requirement: Comment DOCX round-trip

The system SHALL preserve comments when saving to DOCX format. Comments SHALL be serialized to `comments.xml` with proper range markers.

#### Scenario: Save document with comments

- **WHEN** the user saves a document that has comments
- **THEN** comments SHALL be serialized to DOCX `comments.xml` with `commentRangeStart`/`commentRangeEnd` markers in the document body, preserving author, date, content, and threading

#### Scenario: Load and re-save preserves comments

- **WHEN** a DOCX with existing comments is loaded and saved without modification
- **THEN** all original comments SHALL be preserved with identical content, threading, and range positions
