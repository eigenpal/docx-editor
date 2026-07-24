## ADDED Requirements

### Requirement: OOXML support is declared by QName and context
The engine SHALL maintain a machine-readable support manifest keyed by normalized
namespace family, local name, and legal parent context. Each claim MUST independently
declare parse, canonical-model, preservation, rendering, ProseMirror projection,
editing, serialization, and reopen status.

#### Scenario: Same local name appears in different contexts
- **WHEN** an OOXML local name has different semantics under two parent contexts
- **THEN** the manifest records separate claims and evidence for each context

#### Scenario: Coverage report is generated
- **WHEN** CI generates an OOXML support report
- **THEN** it reports separate denominators for schema inventory, encountered fixture contexts, modeled contexts, rendered contexts, and editable contexts without collapsing them into one compatibility percentage

### Requirement: Schema inventory is reproducible
The conformance tooling SHALL derive a versioned QName inventory from the repository's
ECMA-376 schemas and SHALL normalize Strict and Transitional namespace families only
through an explicit reviewed mapping.

#### Scenario: Reference schema changes
- **WHEN** the checked-in XSD inventory changes
- **THEN** CI reports added, removed, or context-changed productions and requires the generated inventory to be refreshed

#### Scenario: Transitional fixture is compared
- **WHEN** a Transitional OOXML fixture is compared with the Strict reference XSDs
- **THEN** tooling uses the reviewed namespace-family mapping and does not claim that direct Strict-schema validation succeeded

### Requirement: Feature capability contributions are registered across pipeline lanes
Each supported feature SHALL use one stable capability ID and package-local
registrations for its applicable core, binding, layout, output, and conformance
handlers. Core MUST NOT import ProseMirror, DOM, layout, or output implementations.

#### Scenario: New editable feature is installed
- **WHEN** a feature declares editable support
- **THEN** registry resolution rejects it unless canonical operations, preservation ownership, serialization, ProseMirror forward and reverse mapping, layout/display behavior, and conformance evidence are present

#### Scenario: Read-only feature is installed
- **WHEN** a feature declares read-only projection
- **THEN** registry resolution requires canonical identity, projection, preservation, and mutation-rejection behavior but does not require semantic write operations

### Requirement: Support claims require executable evidence
Every `supported`, `partial`, `readOnly`, or `verbatim` manifest claim SHALL reference
versioned fixture evidence and a comparator appropriate to that stage.

#### Scenario: Editable claim lacks reopen evidence
- **WHEN** a capability declares an OOXML context editable without save-and-reopen evidence
- **THEN** CI rejects the manifest

#### Scenario: Render claim lacks geometry or semantic evidence
- **WHEN** a capability declares rendered support without a display, geometry, text, or semantic-tree oracle
- **THEN** CI rejects the manifest

### Requirement: Unsupported content fails closed and remains lossless
An OOXML construct without a semantic editing mapper MUST be classified as
`readOnly`, `verbatim`, or `unsupported`. The engine MUST NOT flatten, delete, or
regenerate that construct as a side effect of editing a supported neighbor.

#### Scenario: Editable paragraph contains an unowned child
- **WHEN** a user edits a paragraph containing an OOXML child that the paragraph capability does not own
- **THEN** the engine reinserts an ownership-scoped preservation capsule unchanged or rejects the edit before canonical commit

#### Scenario: Read-only projected node is structurally disturbed
- **WHEN** a ProseMirror transaction deletes, moves, duplicates, or changes the identity of a read-only projected node
- **THEN** the transaction is rejected and canonical state, history, and serialized bytes remain unchanged

### Requirement: Capability ownership is unambiguous
At a resolved registry version, each editable QName/context and operation ID SHALL
have one effective owner after explicit replacement rules. Duplicate, cyclic,
version-incompatible, or missing ownership MUST fail before document publication.

#### Scenario: Two capabilities claim one context
- **WHEN** two installed capabilities claim editable ownership of the same QName and parent context without an explicit replacement relationship
- **THEN** document open fails with a diagnostic naming both capabilities and the conflicting context

### Requirement: Feature lanes preserve package security boundaries
Capability handlers SHALL consume bounded parser records and sanitized runtime
projections. They MUST NOT resolve external entities, fetch remote resources,
execute fields or embedded content, inject raw XML/HTML/CSS, or bypass package path
and resource limits.

#### Scenario: Fixture contains external hyperlinks
- **WHEN** the comprehensive fixture is opened or rendered
- **THEN** no external request occurs and activation uses the sanitized runtime target only after explicit user action

#### Scenario: Fixture contains malformed field instructions
- **WHEN** malformed field instructions are encountered
- **THEN** they remain inert authored content and are neither executed nor reinterpreted as commands

### Requirement: Interaction and WYSIWYG claims use a shared vocabulary
The support manifest MUST declare an optional `interaction` lane using the shared
literals `none`, `rendered`, `interactive-read-only`, `fallback-editable`,
`typed-editable`, `interactive-paginated`, and `feature-wysiwyg`. The machine key
`feature-wysiwyg` MUST be used in manifest data; human-facing prose MAY label the same
state **feature-WYSIWYG**. Vocabulary rules and monotonicity MUST be owned by
`interactive-paginated-editing`; pipeline `SupportState` values in this change remain
independent.

#### Scenario: Interaction lane is omitted
- **WHEN** a capability claim omits the optional `interaction` field
- **THEN** its interaction lane MUST be treated as `none` and MUST NOT imply rendering or page interaction

#### Scenario: Read-only paginated interaction is recorded
- **WHEN** a capability is visible on paginated output with hit/selection ownership but no editable caret on that surface
- **THEN** its interaction lane MAY be `interactive-read-only` and MUST NOT be reported as `fallback-editable` or higher without additional evidence

#### Scenario: Paginated preview repaint is recorded
- **WHEN** a capability repaints committed canonical state on paginated output without direct page editing evidence
- **THEN** its interaction lane MUST remain `rendered` or lower and MUST NOT be reported as `interactive-paginated` or `feature-wysiwyg`

#### Scenario: One feature passes full WYSIWYG comparators
- **WHEN** a declared feature matrix passes every feature-WYSIWYG comparator bundle for that matrix
- **THEN** only that matrix MAY be reported as `feature-wysiwyg` and no whole-product claim SHALL be inferred
