# core-cell-selection-highlight Specification

## Purpose

Defines framework-neutral contracts for behavior shared by supported adapters.

## Requirements

### Requirement: Cell-selection highlight available to both adapters

`@docx-editor.dev/core` SHALL paint the cell-selection highlight itself, so every adapter shows it without adapter code. When a `CellSelection` is active, the paginated surface SHALL compute one rectangle per selected cell from the layout records (`cellSelectionRects` in `packages/core/src/layout/semantic-cell-selection.ts`) and SHALL draw each as a `.docx-cell-selection-rect` element in the selection overlay layer (`paintSelectionOverlay` in `packages/core/src/output/semantic-selection-overlay.ts`). The overlay layer SHALL be a sibling of the painted pages, never a child, so the page painter cannot sweep it and a keystroke cannot land in it. Adapters SHALL NOT paint their own cell-selection highlight.

#### Scenario: Active cell selection is projected

- **WHEN** a `CellSelection` is active and the surface renders its overlay
- **THEN** exactly the cells in the selection's rectangle are covered by `.docx-cell-selection-rect` elements at the painted cell geometry

#### Scenario: Every adapter shows the highlight

- **WHEN** a user selects multiple table cells in any supported adapter
- **THEN** the selected cells are visually highlighted, because the highlight is painted by the core surface both adapters mount

#### Scenario: Non-cell selection clears highlight

- **WHEN** the selection is not a `CellSelection`
- **THEN** no `.docx-cell-selection-rect` element remains in the selection overlay
