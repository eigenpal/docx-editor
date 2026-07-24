## ADDED Requirements

### Requirement: Public packages are product-oriented
The distribution MUST expose product-oriented package names and MUST NOT publish
raw ProseMirror binding, layout, output, synchronization, or other `engine-*`
workspace package names.

#### Scenario: Consumer installs the browser editor
- **WHEN** a consumer installs a supported framework adapter
- **THEN** its declared dependencies provide compatible public `core` and `editor` products without requiring direct `engine-*` installation

### Requirement: Core remains a free headless semantic engine
`@docx-editor.dev/core` MUST provide bounded DOCX parse, canonical semantic
editing, preservation, and DOCX serialization without requiring DOM,
ProseMirror, Yjs, transport, PDF, React, or Vue packages.

#### Scenario: Minimal headless install
- **WHEN** the packed core package is installed in a clean DOM-free Node environment with optional products absent
- **THEN** a supported DOCX can be parsed, edited through semantic operations, saved as DOCX, and reopened without resolving any forbidden dependency

### Requirement: Browser composition has one public owner
`@docx-editor.dev/editor` MUST own the public PM-free `createEditor`, `Editor`,
`EditorHost`, command, query, selection, geometry, display, save, and lifecycle
contracts.

#### Scenario: Framework adapter creates an editor
- **WHEN** React and Vue receive the same document source and editor configuration
- **THEN** both construct the same public editor implementation without importing ProseMirror or private engine packages

### Requirement: Implementation package boundaries remain enforced
The private implementation graph MUST keep canonical core free of ProseMirror,
DOM, Yjs, transport, and PDF imports; ProseMirror interpretation MUST remain
inside the private binding boundary, and server execution MUST NOT depend on the
browser binding.

#### Scenario: Dependency graph validation runs
- **WHEN** a source or manifest import introduces a forbidden upward, sideways, or runtime-specific dependency
- **THEN** package graph validation fails before publication

### Requirement: Common display output has one geometry authority
Layout MUST be the sole geometry authority, DOM and PDF backends MUST consume the
same positioned display IR, and framework adapters MUST NOT remeasure document
content or derive feature geometry.

#### Scenario: A new display-item kind is registered
- **WHEN** the layout engine emits that kind for a supported feature
- **THEN** common output handles it or publication fails before React and Vue can diverge

### Requirement: Optional products remain absent from base graphs
Core and the basic browser editor MUST operate when server, client, agents, and
enterprise packages are absent.

#### Scenario: Basic browser install excludes optional products
- **WHEN** a packed React or Vue adapter is installed with only its declared free runtime dependencies
- **THEN** it can load, edit, render, save, and dispose a supported DOCX without resolving optional product modules

### Requirement: Server remains independent of browser editing
`@docx-editor.dev/server` MUST provide headless document addressing, controlled
semantic editing, and free DOCX save/export without importing the browser editor
or ProseMirror binding.

#### Scenario: Server edits and saves DOCX
- **WHEN** a server process applies a supported semantic edit without enterprise extensions
- **THEN** it can save and reopen DOCX while PDF and collaboration commands remain unavailable

### Requirement: Generated client publication is readiness-gated
`@docx-editor.dev/client` MUST NOT be published until a versioned protocol,
generated artifact, and packed consumer conformance test exist.

#### Scenario: Protocol is not stable
- **WHEN** the server protocol lacks a versioned compatibility contract or generated consumer evidence
- **THEN** release validation rejects a public client package

### Requirement: Framework adapters retain semantic parity
React, Vue, and Nuxt MUST expose equivalent document, command, event, lifecycle,
and imperative-handle behavior over the public editor while retaining only
framework-specific host and chrome code.

#### Scenario: Paired browser scenario executes
- **WHEN** a shared `EditorDriver` scenario runs against React and Vue package entries
- **THEN** editability, canonical effects, display fingerprints, save/reopen results, and errors are equivalent

### Requirement: Public exports do not leak implementation types
Public package declarations MUST NOT expose ProseMirror types, private store
implementations, private registries, source aliases, or imports from another
package's `src` directory.

#### Scenario: API declarations are extracted
- **WHEN** API and consumer type checks inspect every public entry
- **THEN** all referenced types resolve through declared public exports and no forbidden implementation type appears

### Requirement: Packed artifacts are the publication authority
Release conformance MUST test packed production artifacts and their manifests
rather than relying only on workspace aliases or source imports.

#### Scenario: Consumer installs packed products
- **WHEN** minimal headless, framework editor, server, and optional-product fixtures install packed tarballs
- **THEN** runtime imports, peer diagnostics, type declarations, styles, and export maps behave as documented

### Requirement: Namespace migration is gated and reversible
The namespace migration MUST occur from retired core, contract stubs, and private
engine composition only after production editor and paired adapter conformance
passes, and MUST retain compatibility aliases only where old semantics remain
truthful.

#### Scenario: Production adapter conformance is incomplete
- **WHEN** either public React or Vue editing scenarios still require the example-only mount or throwing contract path
- **THEN** the release process refuses to switch the public core/editor namespace
