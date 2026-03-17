## ADDED Requirements

### Requirement: Cell fill picker uses AdvancedColorPicker

The table cell fill color picker SHALL use the `AdvancedColorPicker` component with theme color matrix, standard colors, custom hex input, and a "No fill" option.

#### Scenario: User opens cell fill picker

- **WHEN** user clicks the cell fill toolbar button while cursor is in a table
- **THEN** the AdvancedColorPicker opens showing theme color matrix, standard colors row, and custom hex input

#### Scenario: User selects a theme color for cell fill

- **WHEN** user clicks a theme color swatch in the fill picker
- **THEN** the selected cells' background color SHALL be set to the corresponding RGB value

#### Scenario: User selects "No fill"

- **WHEN** user clicks the "No fill" option in the fill picker
- **THEN** the selected cells' background color SHALL be removed (set to null/transparent)

#### Scenario: User enters custom hex color

- **WHEN** user types a valid 6-digit hex code and clicks "Apply"
- **THEN** the selected cells' background color SHALL be set to that hex color

### Requirement: Old CellBackgroundPicker is removed

The old `CellBackgroundPicker.tsx` component SHALL be deleted. All references to it SHALL be replaced with the new `TableCellFillPicker` wrapper.

#### Scenario: No references to old picker remain

- **WHEN** searching the codebase for `CellBackgroundPicker`
- **THEN** no imports or usages SHALL exist

### Requirement: Individual border presets apply correctly

When a user selects an individual border preset (Left/Right/Top/Bottom), the system SHALL clear all existing borders on selected cells and apply only the requested side's border.

#### Scenario: User clicks "Left border" on a cell with all borders

- **WHEN** a cell has all four borders set AND user clicks "Left border"
- **THEN** only the left border SHALL remain; top, bottom, and right borders SHALL be removed

#### Scenario: User clicks "Top border" on a cell with no borders

- **WHEN** a cell has no borders AND user clicks "Top border"
- **THEN** only the top border SHALL be applied with the current border spec (style, size, color)

#### Scenario: User clicks "Bottom border" after setting border color

- **WHEN** user sets border color to red AND clicks "Bottom border"
- **THEN** only the bottom border SHALL be applied in red; other sides SHALL have no border

### Requirement: ColorPickerRow removed from TableOptionsDropdown

The inline `ColorPickerRow` component inside `TableOptionsDropdown.tsx` SHALL be removed. Border color and cell fill pickers in the dropdown SHALL use `AdvancedColorPicker`-based wrappers instead.

#### Scenario: Dropdown color pickers use AdvancedColorPicker

- **WHEN** user opens the table options dropdown and expands the color section
- **THEN** both border color and cell fill color SHALL use the AdvancedColorPicker UI (theme matrix, standard colors, custom hex)
