## ADDED Requirements

### Requirement: One physical production core package
All production `packages/engine-*` source SHALL move into guarded internal lanes under `packages/core/src`, and the repository SHALL publish one engine package named `@docx-editor.dev/core`. React, Vue, Nuxt, agents, and i18n SHALL remain separate adapter or product packages.

#### Scenario: Consumer installs the browser editor
- **WHEN** a React or Vue adapter imports `@docx-editor.dev/core/editor`
- **THEN** it uses the single published core package and no `@docx-editor.dev/engine-*` package is required

### Requirement: Internal lane boundaries survive physical consolidation
The core source tree SHALL retain separately guarded `contracts`, `store`, `binding`, `layout`, `output`, `editor`, `sync`, `server`, and `clients` lanes. The default semantic-core lane SHALL remain DOM-free, ProseMirror-free, Yjs-free, transport-neutral, and PDF-free.

#### Scenario: Semantic store is typechecked
- **WHEN** the store or contract lane imports a browser, ProseMirror, sync, server, transport, or PDF module
- **THEN** TypeScript project or import-graph validation fails

#### Scenario: Browser editor is bundled
- **WHEN** the `/editor` subpath bundle graph is inspected
- **THEN** server transports, generated server clients, and server-only output dependencies are absent

### Requirement: Intentional subpath exports
`@docx-editor.dev/core` SHALL expose environment-specific public entry points through explicit conditional subpath exports rather than one unrestricted barrel. Unexported internal lanes SHALL remain inaccessible as supported public API.

#### Scenario: Public API is extracted
- **WHEN** API extraction runs for the single core package
- **THEN** each intentional subpath has an reviewed snapshot and no internal implementation path leaks into the public surface

### Requirement: Lane-by-lane compatibility migration
Each `packages/engine-*` workspace package SHALL be removed only after its source, imports, tests, runtime graph, and intended API resolve through `packages/core`. Temporary aliases MAY exist only for the lane currently migrating and SHALL be deleted with that lane's old package.

#### Scenario: Engine package is removed
- **WHEN** a migrated `packages/engine-*` directory is deleted
- **THEN** repository source, tests, scripts, and adapters contain no remaining imports of its old package name

### Requirement: Adapter packages remain thin and separate
React and Vue SHALL remain separately published lifecycle adapters over the same PM-free `@docx-editor.dev/core/editor` boundary. Physical core consolidation SHALL NOT move framework component code or adapter-only styling into core.

#### Scenario: Paired adapters consume core
- **WHEN** React and Vue host the accepted paragraph surface
- **THEN** both import the same core editor contract and neither imports ProseMirror, store internals, layout internals, or server lanes directly
