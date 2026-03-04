## ADDED Requirements

### Requirement: LayoutCoordinator manages the layout pipeline

The `LayoutCoordinator` class SHALL manage the full layout pipeline: converting PM state to flow blocks, measuring blocks, running the layout engine, and triggering the layout painter. It SHALL replace the layout-related state currently in `PagedEditor.tsx`.

#### Scenario: Compute layout from ProseMirror state

- **WHEN** the ProseMirror document changes
- **AND** `LayoutCoordinator.updateDocument(doc, styles, theme)` is called
- **THEN** it SHALL recompute flow blocks, measures, and layout
- **AND** notify subscribers of the new layout

#### Scenario: Cache layout when inputs unchanged

- **WHEN** `updateDocument()` is called with the same document, styles, and theme
- **THEN** it SHALL return the cached layout without recomputation

### Requirement: LayoutCoordinator manages selection state

The `LayoutCoordinator` SHALL track selection rectangles, caret position, drag state, and selection anchor.

#### Scenario: Update selection from ProseMirror

- **WHEN** the ProseMirror selection changes
- **AND** `LayoutCoordinator.updateSelection(selectionRects, caretPosition)` is called
- **THEN** subscribers SHALL be notified with the new selection state

#### Scenario: Track drag selection

- **WHEN** `startDrag(anchor)` is called
- **THEN** the coordinator SHALL enter drag mode
- **WHEN** `updateDrag(currentPos)` is called
- **THEN** it SHALL update the selection range
- **WHEN** `endDrag()` is called
- **THEN** it SHALL finalize the selection and exit drag mode

### Requirement: LayoutCoordinator manages column and image resize

The `LayoutCoordinator` SHALL track table column resize state and image resize/interaction state.

#### Scenario: Start column resize

- **WHEN** `startColumnResize(tableInfo, columnIndex, startX)` is called
- **THEN** the coordinator SHALL track original column widths and resize progress
- **WHEN** `updateColumnResize(currentX)` is called
- **THEN** it SHALL compute new column widths and notify subscribers

#### Scenario: Track image interaction

- **WHEN** `setSelectedImage(imageInfo)` is called
- **THEN** subscribers SHALL be notified of the selected image
- **WHEN** `clearSelectedImage()` is called
- **THEN** the image selection SHALL be cleared

### Requirement: LayoutCoordinator supports external store subscription

The `LayoutCoordinator` SHALL implement a `subscribe(listener)` / `getSnapshot()` pattern compatible with React's `useSyncExternalStore` and Vue's manual subscription.

#### Scenario: React component subscribes

- **WHEN** a React component calls `useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot)`
- **THEN** it SHALL re-render when coordinator state changes

#### Scenario: Unsubscribe on cleanup

- **WHEN** the unsubscribe function returned by `subscribe()` is called
- **THEN** the listener SHALL no longer be notified of state changes

### Requirement: LayoutCoordinator has zero framework dependencies

The `LayoutCoordinator` class SHALL import only from `@eigenpal/docx-core` internals and vanilla DOM APIs. It SHALL NOT import React, Vue, or any framework.

#### Scenario: Verify no framework imports

- **WHEN** inspecting `LayoutCoordinator` source
- **THEN** it SHALL have zero imports from `react`, `react-dom`, `vue`, or any UI framework
