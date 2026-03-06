## ADDED Requirements

### Requirement: Dev server script for Vue

The monorepo root `package.json` SHALL include a `dev:vue` script that starts the Vue example dev server on port 5174.

#### Scenario: Start Vue dev server

- **WHEN** a contributor runs `bun run dev:vue` from the monorepo root
- **THEN** Vite starts serving the Vue example at `http://localhost:5174`

### Requirement: DocxEditorVue component renders DOCX

The `packages/vue` package SHALL export a `DocxEditorVue` Vue 3 component that accepts a DOCX ArrayBuffer and renders it as editable pages using `@eigenpal/docx-core`.

#### Scenario: Render a DOCX buffer

- **WHEN** `DocxEditorVue` receives a `documentBuffer` prop containing a valid DOCX ArrayBuffer
- **THEN** the component parses the buffer, creates a ProseMirror editor, and paints visible pages using layout-painter

#### Scenario: Render an empty document

- **WHEN** `DocxEditorVue` receives a `document` prop with a Document model object
- **THEN** the component renders the document without needing a DOCX buffer

### Requirement: Basic editing via ProseMirror

The `DocxEditorVue` component SHALL support text editing through the hidden ProseMirror instance, handling keyboard input (typing, backspace, enter, undo/redo).

#### Scenario: Type text into editor

- **WHEN** the user clicks on the visible page area and types text
- **THEN** the hidden ProseMirror instance receives the input and layout-painter re-renders the visible pages with the new content

### Requirement: Save document as DOCX

The `DocxEditorVue` component SHALL expose a `save()` method via template ref that serializes the current editor state back to a DOCX Blob.

#### Scenario: Save edited document

- **WHEN** the host application calls `editorRef.save()`
- **THEN** the component returns a Promise resolving to a Blob containing the DOCX file

### Requirement: Basic toolbar

The `packages/vue` package SHALL include a `BasicToolbar.vue` component providing essential formatting controls: bold, italic, underline, and text alignment (left, center, right).

#### Scenario: Apply bold formatting

- **WHEN** the user selects text and clicks the Bold toolbar button
- **THEN** the selected text is toggled bold via the ProseMirror command

### Requirement: Vue example app with file operations

The `examples/vue/App.vue` SHALL provide a working demo with: open DOCX file, create new document, and save/download document.

#### Scenario: Open a DOCX file

- **WHEN** the user clicks "Open DOCX" and selects a .docx file
- **THEN** the file is loaded into the DocxEditorVue component and rendered

#### Scenario: Create a new empty document

- **WHEN** the user clicks "New"
- **THEN** the editor resets to an empty document

#### Scenario: Save and download

- **WHEN** the user clicks "Save"
- **THEN** the current document is serialized and downloaded as a .docx file

### Requirement: Sample document on load

The Vue example app SHALL load a sample DOCX file on initial page load, matching the React example behavior.

#### Scenario: Initial load with sample

- **WHEN** the Vue example page loads
- **THEN** the app fetches `/sample.docx` from the public directory and renders it in the editor
