## ADDED Requirements

### Requirement: Shared transaction→repaint handler

The engine SHALL expose `handleTransaction(tr, newState)` implementing the shared loop: notify the decoration layer, on `docChanged` increment the sync sequence and `scheduleLayout(newState)`, request a selection-overlay render, and on selection-only transactions update the overlay/SDT-focus immediately. The PM `UPDATED_SCROLL` flag SHALL be stripped (so the hidden editor never scrolls an ancestor). Both adapters' `dispatchTransaction` (body and header/footer) SHALL route through `handleTransaction`.

#### Scenario: Doc change schedules a coalesced relayout

- **WHEN** a `docChanged` transaction is handled
- **THEN** the engine schedules a layout (not a synchronous one) and notifies content-change consumers

#### Scenario: Selection-only move skips relayout

- **WHEN** a transaction changes only the selection
- **THEN** the engine updates the selection overlay / content-control focus without a layout pass

#### Scenario: Scroll flag stripped

- **WHEN** a transaction carries PM's scroll-into-view flag
- **THEN** the engine clears it so the off-screen hidden editor doesn't scroll the page

#### Scenario: Header/footer transactions relayout the body

- **WHEN** an HF EditorView transaction changes its doc
- **THEN** the engine writes the HF content back to the Document and schedules a body relayout, matching prior behavior
