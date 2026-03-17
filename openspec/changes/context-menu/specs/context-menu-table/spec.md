## ADDED Requirements

### Requirement: Table row operations in context menu

The system SHALL display row insertion and deletion items when the cursor is inside a table cell.

#### Scenario: Insert row above

- **WHEN** cursor is in a table cell and user clicks "Insert row above" in the context menu
- **THEN** a new row is inserted above the current row

#### Scenario: Insert row below

- **WHEN** cursor is in a table cell and user clicks "Insert row below" in the context menu
- **THEN** a new row is inserted below the current row

#### Scenario: Delete row

- **WHEN** cursor is in a table cell and user clicks "Delete row" in the context menu
- **THEN** the entire current row is deleted

### Requirement: Table column operations in context menu

The system SHALL display column insertion and deletion items when the cursor is inside a table cell.

#### Scenario: Insert column left

- **WHEN** cursor is in a table cell and user clicks "Insert column left" in the context menu
- **THEN** a new column is inserted to the left of the current column

#### Scenario: Insert column right

- **WHEN** cursor is in a table cell and user clicks "Insert column right" in the context menu
- **THEN** a new column is inserted to the right of the current column

#### Scenario: Delete column

- **WHEN** cursor is in a table cell and user clicks "Delete column" in the context menu
- **THEN** the entire current column is deleted

### Requirement: Delete table in context menu

The system SHALL display a "Delete table" item when the cursor is inside a table.

#### Scenario: Delete table

- **WHEN** cursor is in a table cell and user clicks "Delete table" in the context menu
- **THEN** the entire table is deleted from the document

### Requirement: Merge and split cells in context menu

The system SHALL display merge/split cell items when applicable.

#### Scenario: Merge cells with multi-cell selection

- **WHEN** user has multiple table cells selected and right-clicks
- **THEN** a "Merge cells" item appears and clicking it merges the selected cells

#### Scenario: Split cell on merged cell

- **WHEN** cursor is in a merged cell and user right-clicks
- **THEN** a "Split cell" item appears and clicking it splits the merged cell

#### Scenario: Merge/split hidden when not applicable

- **WHEN** cursor is in a single unmerged cell with no multi-cell selection
- **THEN** neither "Merge cells" nor "Split cell" items appear

### Requirement: Table items separated from base items

The system SHALL visually separate table-specific items from base clipboard items using a divider line.

#### Scenario: Table context menu layout

- **WHEN** user right-clicks inside a table cell
- **THEN** the menu shows base items (Cut, Copy, Paste, etc.), a separator, then table items (Insert row above, Insert row below, Insert column left, Insert column right), a separator, then destructive items (Delete row, Delete column, Delete table)
