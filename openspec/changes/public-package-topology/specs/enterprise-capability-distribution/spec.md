## ADDED Requirements

### Requirement: Paid capabilities share one package boundary
All paid document-engine capabilities MUST be distributed through
`@docx-editor.dev/enterprise` and MUST NOT be published as separate top-level
comments, revisions, collaboration, synchronization, or PDF packages.

#### Scenario: Enterprise consumer installs review features
- **WHEN** a consumer installs the enterprise package
- **THEN** compatible comments and revisions capability entry points are available under the same package version and license boundary

### Requirement: Enterprise entry points are isolated
The enterprise package MUST expose comments, revisions, collaboration, and PDF
through explicit isolated subpaths and MUST NOT eagerly initialize all
capabilities from a root barrel.

#### Scenario: Consumer imports comments only
- **WHEN** an application imports `@docx-editor.dev/enterprise/comments`
- **THEN** collaboration, Yjs, PDF, React, and Vue runtime modules are not evaluated

### Requirement: Enterprise registration is explicit and instance-scoped
Enterprise subpaths MUST return explicit extension registrations scoped to a
document or editor instance and MUST NOT mutate a process-global registry merely
because a module was imported.

#### Scenario: Two editors use different entitlements
- **WHEN** one editor opens with comments enabled and another opens without enterprise extensions
- **THEN** each editor's commands, projections, output, and disposal remain isolated

### Requirement: Free DOCX behavior remains complete
The free distribution MUST provide DOCX parsing, bounded preservation, supported
semantic editing, and DOCX save/export without the enterprise package;
enterprise package absence MUST NOT make a no-op or unrelated safe save lossy.

#### Scenario: Free editor opens a document containing enterprise OOXML
- **WHEN** comments, revision markup, or collaboration metadata is encountered without enterprise extensions
- **THEN** the source content is preserved under its declared fallback and DOCX save retains unaffected package state

### Requirement: Missing enterprise capabilities fail closed
An absent or unentitled enterprise capability MUST resolve to `verbatim`,
`readOnlyProjected`, or `reject` according to its registered fallback and MUST
never authorize flattening, deletion, external fetch, field execution, or
boundary-crossing mutation.

#### Scenario: User edits across a preserved revision boundary
- **WHEN** the free editor cannot safely reinsert or semantically own the affected revision content
- **THEN** the canonical transaction is rejected atomically with a structured read-only diagnostic

### Requirement: Comments and revisions provide paired feature UI
Comments and revisions MUST provide feature-specific React and Vue subpaths with
equivalent commands, events, read-only behavior, and lifecycle, while base
framework adapters remain enterprise-neutral.

#### Scenario: Comment workflow runs in paired adapters
- **WHEN** the same enterprise comment scenario runs through React and Vue
- **THEN** both produce equivalent canonical effects, display evidence, save/reopen results, and error codes

### Requirement: Collaboration owns the public Yjs boundary
Enterprise collaboration MUST be the only public Yjs-facing capability;
`engine-sync` MUST remain private, and free core/editor/server packages MUST work
with Yjs absent.

#### Scenario: Collaboration is not installed
- **WHEN** a free consumer installs and runs core, editor, or server without Yjs
- **THEN** local parse, edit, render, and DOCX save work without resolving synchronization modules

#### Scenario: Collaboration server extension is enabled
- **WHEN** an entitled server registers the enterprise collaboration server extension
- **THEN** replication, persistence, and awareness attach through opaque backend contracts without introducing ProseMirror into the server graph

### Requirement: PDF is the enterprise export boundary
Native PDF export MUST require the enterprise PDF extension, MUST consume the
same positioned display IR as free DOM output, and MUST NOT change the
availability of free DOCX save/export.

#### Scenario: Free consumer requests PDF
- **WHEN** no entitled enterprise PDF extension is registered
- **THEN** PDF export returns a stable unavailable-or-unlicensed error while DOCX save remains available

#### Scenario: Enterprise consumer exports PDF
- **WHEN** an entitled PDF extension receives deterministic positioned display output
- **THEN** it emits PDF without rederiving document geometry or importing browser binding state

### Requirement: Heavy enterprise peers are capability-local
Yjs, the selected PDF implementation, React, and Vue MUST be optional
capability-local peers or isolated build dependencies and MUST be validated only
when their corresponding enterprise subpaths are used.

#### Scenario: Headless revisions consumer omits optional peers
- **WHEN** a server imports only the headless revisions capability
- **THEN** module resolution succeeds without Yjs, PDF, React, or Vue installed

### Requirement: Public enterprise contracts remain implementation-neutral
Enterprise public declarations MUST use stable core/editor/server extension
contracts and MUST NOT expose ProseMirror views, private stores, private engine
registries, or private source paths.

#### Scenario: Enterprise declarations are extracted
- **WHEN** API extraction and consumer type tests inspect every enterprise subpath
- **THEN** all signatures resolve through declared public product contracts and contain no forbidden implementation types

### Requirement: Enterprise package compatibility is explicit
The enterprise package MUST declare compatible core, editor, and server ranges,
and all enterprise subpaths MUST share one package version.

#### Scenario: Incompatible core is installed
- **WHEN** enterprise initialization detects an unsupported public contract version
- **THEN** it fails before document publication with a stable compatibility diagnostic

### Requirement: Enterprise distribution has an absence matrix
Release conformance MUST test each enterprise capability alone, supported
combinations, the complete enterprise set, and complete enterprise absence
against packed production artifacts.

#### Scenario: Enterprise release is prepared
- **WHEN** comments, revisions, collaboration, or PDF changes are included
- **THEN** CI proves isolated imports, entitlement behavior, optional-peer absence, paired UI where applicable, and unaffected free DOCX workflows
