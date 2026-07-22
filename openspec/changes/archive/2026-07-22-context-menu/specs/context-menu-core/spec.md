## ADDED Requirements

### Requirement: Right-click opens context menu

The system SHALL intercept the `contextmenu` event on the editor pages container and display a custom context menu at the click position instead of the browser's default context menu.

#### Scenario: Right-click on editor content

- **WHEN** user right-clicks anywhere on the editor pages
- **THEN** the browser's default context menu is suppressed and a custom context menu appears at the mouse position

#### Scenario: Right-click outside editor pages

- **WHEN** user right-clicks outside the pages container (e.g., toolbar, sidebar)
- **THEN** the browser's default context menu is shown (no interception)

### Requirement: Context resolution from click position

The system SHALL determine the editing context at the right-click position by inspecting the ProseMirror document structure. The resolved context SHALL include: whether text is selected, whether the position is inside a table cell, whether the position is on an image node, and whether the position has a hyperlink mark.

#### Scenario: Right-click on plain text

- **WHEN** user right-clicks on a text paragraph with no special elements
- **THEN** the context resolves to `{ isTextSelected: false, isInTable: false, isOnImage: false, isOnHyperlink: false }`

#### Scenario: Right-click inside a table cell

- **WHEN** user right-clicks inside a table cell
- **THEN** the context resolves with `isInTable: true` and includes table metadata (row count, column count)

#### Scenario: Right-click on an image

- **WHEN** user right-clicks on an image node
- **THEN** the context resolves with `isOnImage: true`

#### Scenario: Right-click on a hyperlink

- **WHEN** user right-clicks on text that has a hyperlink mark
- **THEN** the context resolves with `isOnHyperlink: true` and includes the link href

#### Scenario: Overlapping contexts

- **WHEN** user right-clicks on a hyperlink inside a table cell
- **THEN** the context resolves with both `isInTable: true` and `isOnHyperlink: true`

### Requirement: Selection behavior on right-click

The system SHALL update the ProseMirror selection based on where the right-click occurs relative to any existing selection.

#### Scenario: Right-click outside current selection

- **WHEN** user has text selected and right-clicks outside that selection
- **THEN** the selection is moved to the right-click position (cursor placed there)

#### Scenario: Right-click inside current selection

- **WHEN** user has text selected and right-clicks within that selection
- **THEN** the existing selection is preserved

### Requirement: Menu items composed from context

The system SHALL compose the context menu item list dynamically based on the resolved context. Items from multiple context providers SHALL be combined with separator lines between groups.

#### Scenario: Multiple contexts active

- **WHEN** user right-clicks on a hyperlink inside a table
- **THEN** the menu shows base items, hyperlink items, and table items separated by dividers

#### Scenario: Disabled items

- **WHEN** an operation is not available (e.g., Cut when nothing is selected)
- **THEN** the menu item SHALL appear disabled (grayed out, not clickable)

### Requirement: Keyboard navigation

The system SHALL support keyboard navigation within the open context menu.

#### Scenario: Arrow key navigation

- **WHEN** the context menu is open and user presses ArrowDown/ArrowUp
- **THEN** focus moves to the next/previous enabled menu item, skipping separators and disabled items

#### Scenario: Enter activates item

- **WHEN** a menu item is focused and user presses Enter
- **THEN** the item's action is executed and the menu closes

#### Scenario: Escape closes menu

- **WHEN** the context menu is open and user presses Escape
- **THEN** the menu closes without executing any action

### Requirement: Viewport-aware positioning

The system SHALL position the context menu so it remains fully visible within the viewport.

#### Scenario: Right-click near bottom edge

- **WHEN** user right-clicks near the bottom of the viewport
- **THEN** the menu opens above the click position instead of below

#### Scenario: Right-click near right edge

- **WHEN** user right-clicks near the right edge of the viewport
- **THEN** the menu opens to the left of the click position instead of to the right

### Requirement: Menu closes on outside interaction

The system SHALL close the context menu when the user interacts outside of it.

#### Scenario: Click outside menu

- **WHEN** the context menu is open and user clicks anywhere outside it
- **THEN** the menu closes

#### Scenario: Scroll while menu open

- **WHEN** the context menu is open and user scrolls the page
- **THEN** the menu closes

#### Scenario: Right-click elsewhere

- **WHEN** the context menu is open and user right-clicks on a different position
- **THEN** the current menu closes and a new menu opens at the new position
