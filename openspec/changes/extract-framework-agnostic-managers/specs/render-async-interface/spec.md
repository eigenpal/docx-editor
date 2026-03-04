## ADDED Requirements

### Requirement: EditorHandle interface in core

The `@eigenpal/docx-core` package SHALL export an `EditorHandle` interface defining the contract for an imperatively mounted editor instance.

#### Scenario: EditorHandle provides document operations

- **WHEN** a consumer obtains an `EditorHandle` from a `renderAsync` implementation
- **THEN** it SHALL expose `save(): Promise<Blob>`, `getDocument(): Document`, `focus(): void`, and `destroy(): void`

#### Scenario: EditorHandle is framework-agnostic

- **WHEN** inspecting the `EditorHandle` interface
- **THEN** it SHALL NOT reference React, Vue, or any framework-specific types

### Requirement: React renderAsync implements EditorHandle

The `@eigenpal/docx-js-editor` package SHALL export a `renderAsync(input, container, options): Promise<EditorHandle>` function that mounts a React editor into a DOM element.

#### Scenario: Mount editor imperatively with React

- **WHEN** `renderAsync(docxBuffer, containerDiv, options)` is called
- **THEN** it SHALL create a React root, render the editor, and resolve with an `EditorHandle`
- **AND** calling `handle.destroy()` SHALL unmount the React root

#### Scenario: Existing renderAsync behavior preserved

- **WHEN** existing code uses `renderAsync`
- **THEN** the returned handle SHALL provide the same capabilities as the current implementation

### Requirement: Vue renderAsync scaffolded

The `@eigenpal/docx-editor-vue` package SHALL scaffold a `renderAsync(input, container, options): Promise<EditorHandle>` function signature using `Vue.createApp().mount()`.

#### Scenario: Vue renderAsync placeholder exists

- **WHEN** inspecting `@eigenpal/docx-editor-vue` exports
- **THEN** a `renderAsync` function type or stub SHALL exist
- **AND** it SHALL return `Promise<EditorHandle>` from `@eigenpal/docx-core`
