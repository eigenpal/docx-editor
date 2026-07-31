## ADDED Requirements

### Requirement: Pure table-resize readers and commit builders in core

`@docx-editor.dev/core` SHALL expose `readColumnWidths`, `readRowHeight`, `readLastColumnWidth`, `commitColumnResize`, `commitRowResize`, and `commitRightEdgeResize`, plus the shared constants (`TWIPS_PER_PIXEL`, `MIN_CELL_WIDTH_TWIPS`, `MIN_ROW_HEIGHT_TWIPS`). These are pure `(view, opts) → void | values` functions with no framework coupling. The resize gesture FSMs SHALL remain in each adapter.

#### Scenario: Column resize commit

- **WHEN** `commitColumnResize(view, opts)` is called with a column index and new left/right widths
- **THEN** the table and affected cell widths are updated atomically via a single transaction

#### Scenario: Row and right-edge resize commits

- **WHEN** `commitRowResize` or `commitRightEdgeResize` is called
- **THEN** the row height / last-column width is updated according to the requested delta, honoring the minimum-size constants

#### Scenario: Adapters keep their FSMs

- **WHEN** the readers/commits are centralized
- **THEN** each adapter retains its gesture state machine and calls core for reads and commits; the body-vs-header/footer target view is still resolved by the adapter
