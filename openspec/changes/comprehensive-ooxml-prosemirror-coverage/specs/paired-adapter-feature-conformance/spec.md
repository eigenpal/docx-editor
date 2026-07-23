## ADDED Requirements

### Requirement: React and Vue use one production editor composition
React and Vue adapters SHALL construct the same production `Editor` implementation
through PM-free `EditorHost` contracts. Parsing, canonical storage, ProseMirror
binding, editability policy, layout, output, save, rejection, and reconciliation
logic MUST NOT be duplicated in framework adapters or examples.

#### Scenario: Both adapters open the comprehensive fixture
- **WHEN** React and Vue receive the same bytes, resources, configuration, and feature set
- **THEN** both expose the same editability result, authored-state fingerprint, pagination fingerprint, display fingerprint, and unsupported-feature diagnostics

### Requirement: Example editing infrastructure migrates behind stable contracts
The framework-agnostic session, mounting lifecycle, preview, and driver behavior MUST
migrate from `examples/shared` into production engine
composition. Examples SHALL consume public adapter entries rather than source-only
engine orchestration.

#### Scenario: Installed adapter opens an editable fixture
- **WHEN** an external-style consumer imports the declared React or Vue package entry
- **THEN** it can load, edit, render, save, and dispose the document without importing `examples/shared`, private contract stubs, source aliases, or ProseMirror types

### Requirement: Adapter responsibilities remain thin
Adapters SHALL own framework lifecycle, DOM element getters, frame scheduling,
post-commit notification, event forwarding, and framework-specific chrome only.
They MUST NOT interpret OOXML, map ProseMirror transactions, derive geometry, or
implement feature-specific semantic operations.

#### Scenario: New OOXML feature lands
- **WHEN** a registered feature adds canonical, binding, layout, and output support
- **THEN** React and Vue gain equivalent behavior without feature-specific framework code, except a paired display primitive only when the common output contract requires one

### Requirement: One engine-neutral driver verifies both adapters
Browser conformance SHALL use one versioned `EditorDriver` contract expressed in
public commands, queries, snapshots, display comparators, and save/reopen results.
Tests MUST NOT depend on ProseMirror positions, private views, or framework DOM
structure.

#### Scenario: Feature scenario runs in paired browsers
- **WHEN** a feature registers a shared browser scenario
- **THEN** the identical scenario executes against React and Vue and the feature remains incomplete if either adapter fails

### Requirement: Feature evidence is layered
Each feature SHALL pass framework-independent parse/model/preserve, layout/display,
binding/edit, and save/reopen tests before paired browser smoke. Browser tests SHALL
verify integration and user-observable behavior rather than duplicate semantic unit
coverage.

#### Scenario: Headless feature conformance fails
- **WHEN** a feature fails its canonical or save/reopen comparator
- **THEN** paired browser evidence cannot upgrade its manifest claim to editable or rendered support

### Requirement: Read-only behavior is identical and explainable
Both adapters SHALL expose the same structured reason when a document, story,
feature, or selection is read-only. Saving a wholly read-only document MUST return
the original package bytes unless an explicit safe non-lossless export is requested.

#### Scenario: Comprehensive fixture is partially supported
- **WHEN** the fixture contains editable and read-only feature regions
- **THEN** both adapters render the same regions, enable the same commands, reject the same boundary-crossing edits, and report the same capability IDs responsible

### Requirement: Display output is shared
React and Vue SHALL consume one positioned display contract whose geometry is derived
only by engine layout. Framework painters MUST preserve all display-item kinds,
semantics, clipping, transforms, links, and hit-test ownership or delegate painting
to the common output backend.

#### Scenario: Table, drawing, and annotation display items are emitted
- **WHEN** the comprehensive fixture produces those display items
- **THEN** both adapters paint equivalent geometry and semantics without reinterpreting CSS layout

### Requirement: Adapter lifecycle is isolated per editor instance
Each adapter instance SHALL own independent host elements, editor lifecycle,
selection, scroll state, display state, and cancellation. Destroying or rerendering
one instance MUST NOT mutate another.

#### Scenario: Two editors use different feature sets
- **WHEN** two React or Vue editor instances open different documents with different registered capabilities
- **THEN** operations, display updates, and disposal remain scoped to the correct instance

### Requirement: Retired and temporary paths retire by explicit migration
The migration MUST inventory the retired npm-core demo path, contract-only throwing
`createEditor`, example-only mount, duplicate driver globals, and PM-facing browser
hooks and MUST remove them only after public adapter conformance passes.

#### Scenario: Temporary edit query path is retired
- **WHEN** both public adapters pass the production editing and comprehensive-fixture conformance matrix
- **THEN** the `?edit=1` source-only path can be removed without reducing tested behavior or public API coverage
