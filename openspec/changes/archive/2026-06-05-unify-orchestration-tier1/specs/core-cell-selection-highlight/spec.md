## ADDED Requirements

### Requirement: Cell-selection highlight available to both adapters

`@docx-editor.dev/core` SHALL expose `applyCellSelectionHighlight(container, state, options?)` as a framework-neutral DOM projection helper. It SHALL paint the `.layout-table-cell-selected` class on painted cells whose PM positions fall inside an active `CellSelection`, scoped by `options.scope` (`body` | `header` | `footer`). Both the React and Vue adapters SHALL call it.

#### Scenario: Active cell selection is projected

- **WHEN** a CellSelection is active and `applyCellSelectionHighlight` runs against the body scope
- **THEN** exactly the cells whose mapped positions intersect the active `CellSelection` receive `.layout-table-cell-selected`

#### Scenario: Vue gains cell-selection highlight

- **WHEN** a user selects multiple table cells in the Vue editor
- **THEN** the selected cells are visually highlighted consistently in every supported adapter

#### Scenario: Non-cell selection clears highlight

- **WHEN** the selection is not a CellSelection
- **THEN** no cell carries the selected class in the scoped container
