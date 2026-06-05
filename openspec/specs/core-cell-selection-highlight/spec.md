# core-cell-selection-highlight Specification

## Purpose

TBD - created by archiving change unify-orchestration-tier1. Update Purpose after archive.

## Requirements

### Requirement: Cell-selection highlight available to both adapters

`@eigenpal/docx-editor-core` SHALL expose `applyCellSelectionHighlight(container, state, options?)`, lifted from React's `internals/domSelection.ts`. It SHALL paint the `.layout-table-cell-selected` class on painted cells whose PM positions fall inside an active `CellSelection`, scoped by `options.scope` (`body` | `header` | `footer`). Both the React and Vue adapters SHALL call it.

#### Scenario: React behavior preserved after lift

- **WHEN** a CellSelection is active and `applyCellSelectionHighlight` runs against the body scope
- **THEN** the same set of cells receive `.layout-table-cell-selected` as before the lift

#### Scenario: Vue gains cell-selection highlight

- **WHEN** a user selects multiple table cells in the Vue editor
- **THEN** the selected cells are visually highlighted, matching React (Vue previously rendered no highlight)

#### Scenario: Non-cell selection clears highlight

- **WHEN** the selection is not a CellSelection
- **THEN** no cell carries the selected class in the scoped container
