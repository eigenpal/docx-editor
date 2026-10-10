## ADDED Requirements

### Requirement: ClipboardManager handles clipboard operations

The `ClipboardManager` class SHALL handle clipboard read/write, DOM selection traversal, and formatting extraction without framework dependencies.

#### Scenario: Copy selection to clipboard

- **WHEN** `ClipboardManager.copy(editorView)` is called
- **THEN** it SHALL read the current DOM selection, extract formatting from computed styles, and write to the system clipboard

#### Scenario: Paste from clipboard

- **WHEN** `ClipboardManager.paste(editorView)` is called
- **THEN** it SHALL read from the system clipboard, convert HTML/plain text to ProseMirror content, and insert at the current selection

#### Scenario: Extract formatting from DOM elements

- **WHEN** `ClipboardManager.extractFormattingFromElement(element)` is called
- **THEN** it SHALL use `window.getComputedStyle()` to extract font, size, color, bold, italic, and other formatting properties
- **AND** return a framework-agnostic formatting object

### Requirement: AutoSaveManager handles persistence

The `AutoSaveManager` class SHALL handle debounced saving to localStorage and restore on load.

#### Scenario: Auto-save document changes

- **WHEN** the document changes
- **AND** `AutoSaveManager.onDocumentChanged(doc)` is called
- **THEN** it SHALL debounce and save to localStorage after the configured delay

#### Scenario: Restore saved document

- **WHEN** `AutoSaveManager.restore(key)` is called
- **THEN** it SHALL return the saved document buffer from localStorage if it exists
- **AND** return `null` if no saved document exists

#### Scenario: Clear saved document

- **WHEN** `AutoSaveManager.clear(key)` is called
- **THEN** it SHALL remove the saved document from localStorage

### Requirement: TableSelectionManager handles multi-cell selection

The `TableSelectionManager` class SHALL manage table cell selection state using data attribute queries on the DOM.

#### Scenario: Select a range of cells

- **WHEN** `TableSelectionManager.selectRange(startCell, endCell)` is called
- **THEN** it SHALL compute the rectangular selection of cells between start and end
- **AND** `getSelectedCells()` SHALL return the selected cell coordinates

#### Scenario: Query cell from DOM element

- **WHEN** `TableSelectionManager.getCellFromElement(element)` is called
- **THEN** it SHALL read `data-table-index`, `data-row`, `data-col` attributes
- **AND** return the cell coordinates or `null` if the element is not a table cell

#### Scenario: Clear selection

- **WHEN** `TableSelectionManager.clearSelection()` is called
- **THEN** `getSelectedCells()` SHALL return an empty array
- **AND** subscribers SHALL be notified

### Requirement: ErrorManager handles error notifications

The `ErrorManager` class SHALL replace React's `componentDidCatch` + context pattern with a framework-agnostic pub/sub error notification system.

#### Scenario: Show an error notification

- **WHEN** `ErrorManager.showError(message, options)` is called
- **THEN** subscribers SHALL be notified with the new error notification
- **AND** `getNotifications()` SHALL include the new error

#### Scenario: Dismiss an error

- **WHEN** `ErrorManager.dismiss(id)` is called
- **THEN** the notification SHALL be removed
- **AND** subscribers SHALL be notified

#### Scenario: Subscribe to error notifications

- **WHEN** a framework component subscribes via `ErrorManager.subscribe(listener)`
- **THEN** it SHALL be called whenever notifications change

### Requirement: PluginLifecycleManager handles plugin state

The `PluginLifecycleManager` class SHALL manage EditorPlugin lifecycle — initialization, state tracking, dispatch wrapping, CSS injection, and DOM event listening — without framework dependencies.

#### Scenario: Initialize plugins

- **WHEN** `PluginLifecycleManager.initialize(plugins, editorView)` is called
- **THEN** it SHALL call `plugin.initialize(editorView)` for each plugin
- **AND** store the initial plugin states

#### Scenario: Update plugin states on editor change

- **WHEN** the editor state changes
- **AND** `PluginLifecycleManager.updateStates(editorView)` is called
- **THEN** it SHALL call `plugin.onStateChange(editorView)` for each plugin
- **AND** notify subscribers if any plugin state changed

#### Scenario: Inject plugin CSS

- **WHEN** a plugin has a `styles` property
- **THEN** `PluginLifecycleManager` SHALL inject a `<style>` element with the plugin's CSS
- **AND** remove it when the plugin is destroyed

#### Scenario: Destroy plugins

- **WHEN** `PluginLifecycleManager.destroy()` is called
- **THEN** it SHALL call `plugin.destroy()` for each plugin
- **AND** remove all injected styles
- **AND** remove all DOM event listeners

### Requirement: All manager classes have zero framework dependencies

All manager classes SHALL be plain TypeScript classes with no imports from React, Vue, or any UI framework.

#### Scenario: Verify framework independence

- **WHEN** inspecting the source of `ClipboardManager`, `AutoSaveManager`, `TableSelectionManager`, `ErrorManager`, and `PluginLifecycleManager`
- **THEN** none SHALL import from `react`, `react-dom`, `vue`, or any UI framework
