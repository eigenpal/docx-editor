## ADDED Requirements

### Requirement: Edit link in context menu

The system SHALL display an "Edit link" item when the user right-clicks on a hyperlink.

#### Scenario: Edit link

- **WHEN** user right-clicks on a hyperlink and clicks "Edit link" in the context menu
- **THEN** the link editing dialog/flow is opened with the current href and tooltip pre-filled

### Requirement: Remove link in context menu

The system SHALL display a "Remove link" item when the user right-clicks on a hyperlink.

#### Scenario: Remove link

- **WHEN** user right-clicks on a hyperlink and clicks "Remove link" in the context menu
- **THEN** the hyperlink mark is removed from the text, preserving the text content

### Requirement: Open link in context menu

The system SHALL display an "Open link" item when the user right-clicks on a hyperlink.

#### Scenario: Open link in new tab

- **WHEN** user right-clicks on a hyperlink and clicks "Open link" in the context menu
- **THEN** the link URL is opened in a new browser tab

### Requirement: Link items only shown on hyperlinks

The system SHALL only show link-specific context menu items when a hyperlink is right-clicked.

#### Scenario: No link items on plain text

- **WHEN** user right-clicks on text that has no hyperlink mark
- **THEN** no link-specific items appear in the context menu

#### Scenario: Link items alongside other contexts

- **WHEN** user right-clicks on a hyperlink inside a table cell
- **THEN** both link items and table items appear in the context menu, separated by a divider
