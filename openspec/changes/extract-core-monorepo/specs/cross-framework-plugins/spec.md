## ADDED Requirements

### Requirement: Framework-agnostic EditorPluginCore interface in core

The `@eigenpal/docx-core` package SHALL export an `EditorPluginCore` interface containing all framework-agnostic plugin fields: `id`, `name`, `proseMirrorPlugins`, `onStateChange`, `initialize`, `destroy`, `styles`, and `panelConfig`.

#### Scenario: Define a plugin with core logic only

- **WHEN** a plugin author imports `EditorPluginCore` from `@eigenpal/docx-core`
- **AND** creates a plugin with `id`, `proseMirrorPlugins`, `onStateChange`, and `styles`
- **THEN** the plugin definition SHALL compile without React or Vue as dependencies

#### Scenario: EditorPluginCore has no framework types

- **WHEN** inspecting the `EditorPluginCore` interface in `@eigenpal/docx-core`
- **THEN** it SHALL NOT reference `ReactNode`, `React.ComponentType`, `DefineComponent`, `VNode`, or any framework-specific types

### Requirement: PluginPanelProps exported from core without framework types

The `@eigenpal/docx-core` package SHALL export a `PluginPanelProps` interface containing the framework-agnostic fields: `editorView`, `doc`, `scrollToPosition`, `selectRange`, `pluginState`, `panelWidth`, and `renderedDomContext`.

#### Scenario: PluginPanelProps usable by any framework

- **WHEN** a framework adapter imports `PluginPanelProps` from `@eigenpal/docx-core`
- **THEN** it SHALL be able to extend or use it as props for its own component type
- **AND** `PluginPanelProps` SHALL NOT contain any framework-specific fields

### Requirement: RenderedDomContext exported from core

The `@eigenpal/docx-core` package SHALL export the `RenderedDomContext` interface and its implementation, as it uses only vanilla DOM APIs.

#### Scenario: RenderedDomContext available to plugin overlays

- **WHEN** a plugin overlay (in any framework) needs to map ProseMirror positions to pixel coordinates
- **THEN** it SHALL import `RenderedDomContext` from `@eigenpal/docx-core`
- **AND** use `getCoordinatesForPosition()`, `getRectsForRange()`, and `findElementsForRange()` without any framework dependency

### Requirement: PanelConfig exported from core

The `@eigenpal/docx-core` package SHALL export the `PanelConfig` type (position, default width, collapsible settings).

#### Scenario: Plugin specifies panel position

- **WHEN** a plugin sets `panelConfig: { position: 'right', defaultWidth: 280 }`
- **THEN** both React and Vue PluginHosts SHALL interpret this identically

### Requirement: ReactEditorPlugin extends EditorPluginCore

The `@eigenpal/docx-js-editor` package SHALL export a `ReactEditorPlugin` interface that extends `EditorPluginCore` with React-specific fields: `Panel` (React.ComponentType) and `renderOverlay` (returns ReactNode).

#### Scenario: Existing React plugins remain compatible

- **WHEN** the existing template plugin is updated to use `ReactEditorPlugin`
- **THEN** it SHALL compile and function identically to the current `EditorPlugin` interface
- **AND** no behavioral changes SHALL occur

#### Scenario: React plugin spreads core into adapter

- **WHEN** a plugin author creates an `EditorPluginCore` object and spreads it into a `ReactEditorPlugin`
- **THEN** the result SHALL be a valid `ReactEditorPlugin` with both core logic and React UI

### Requirement: ReactPluginHost renders ReactEditorPlugin panels and overlays

The `@eigenpal/docx-js-editor` package SHALL contain a `PluginHost` (or `ReactPluginHost`) component that accepts `ReactEditorPlugin[]` and renders panels/overlays using React.

#### Scenario: PluginHost manages plugin lifecycle

- **WHEN** `PluginHost` receives an array of `ReactEditorPlugin` instances
- **THEN** it SHALL call `initialize()` on mount, `onStateChange()` on editor changes, and `destroy()` on unmount
- **AND** it SHALL render `Panel` components in configured positions
- **AND** it SHALL render `renderOverlay()` output in the viewport overlay container

### Requirement: VueEditorPlugin interface scaffolded in Vue package

The `@eigenpal/docx-editor-vue` package SHALL export a `VueEditorPlugin` interface that extends `EditorPluginCore` with Vue-specific fields for panel and overlay rendering.

#### Scenario: Vue plugin interface mirrors React adapter pattern

- **WHEN** inspecting `VueEditorPlugin` in `@eigenpal/docx-editor-vue`
- **THEN** it SHALL extend `EditorPluginCore` from `@eigenpal/docx-core`
- **AND** it SHALL define `Panel` using Vue's `DefineComponent` (or equivalent)
- **AND** it SHALL define `renderOverlay` returning Vue's `VNode` (or equivalent)

### Requirement: CorePlugin system unchanged

The existing `CorePlugin` interface and `PluginRegistry` in `@eigenpal/docx-core` SHALL remain unchanged, as they are already framework-agnostic.

#### Scenario: CorePlugin continues to work headlessly

- **WHEN** a `CorePlugin` is registered with command handlers and MCP tools
- **THEN** it SHALL function identically to the current implementation
- **AND** no changes to the `CorePlugin` interface SHALL be required
