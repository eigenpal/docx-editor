## ADDED Requirements

### Requirement: EditorCoordinator manages document lifecycle

The `EditorCoordinator` class SHALL manage document parsing, loading, font loading, and saving. It SHALL replace the document lifecycle state currently in `DocxEditor.tsx`.

#### Scenario: Load a DOCX file

- **WHEN** `EditorCoordinator.loadDocument(buffer)` is called with a DOCX file buffer
- **THEN** it SHALL parse the document, load required fonts, and notify subscribers when ready
- **AND** `getDocument()` SHALL return the parsed `Document`

#### Scenario: Save the current document

- **WHEN** `EditorCoordinator.save()` is called
- **THEN** it SHALL serialize the current ProseMirror state back to a DOCX blob
- **AND** return the blob to the caller

### Requirement: EditorCoordinator manages zoom

The `EditorCoordinator` SHALL track the current zoom level.

#### Scenario: Change zoom level

- **WHEN** `setZoom(level)` is called
- **THEN** subscribers SHALL be notified of the new zoom level
- **AND** `getZoom()` SHALL return the updated value

### Requirement: EditorCoordinator manages extension manager

The `EditorCoordinator` SHALL hold and initialize the `ExtensionManager` instance, building the ProseMirror schema and runtime.

#### Scenario: Initialize extensions

- **WHEN** `EditorCoordinator` is constructed with an extension configuration
- **THEN** it SHALL create an `ExtensionManager`, build the schema, and expose it via `getSchema()`
- **AND** after `EditorState` is created, `initializeRuntime()` SHALL be called

### Requirement: EditorCoordinator dispatches agent commands

The `EditorCoordinator` SHALL accept and execute agent commands against the current document.

#### Scenario: Execute an agent command

- **WHEN** `executeCommand(command)` is called
- **THEN** it SHALL apply the command to the current document using the agent executor
- **AND** update the document state
- **AND** notify subscribers of the document change

### Requirement: EditorCoordinator supports external store subscription

The `EditorCoordinator` SHALL implement the same `subscribe(listener)` / `getSnapshot()` pattern as `LayoutCoordinator`.

#### Scenario: Subscribe to editor state changes

- **WHEN** a framework component subscribes to the coordinator
- **THEN** it SHALL be notified on document load, zoom change, or command execution

### Requirement: EditorCoordinator has zero framework dependencies

The `EditorCoordinator` class SHALL import only from `@eigenpal/docx-core` internals and vanilla APIs.

#### Scenario: Verify no framework imports

- **WHEN** inspecting `EditorCoordinator` source
- **THEN** it SHALL have zero imports from `react`, `react-dom`, `vue`, or any UI framework
