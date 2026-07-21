## ADDED Requirements

### Requirement: Capability registry spans the engine pipeline
The capability registry SHALL support parse, serialize, validate, normalize,
semantic command/query, target resolution, editor mapping, dependency analysis,
measurement, pagination, display-list, object-model, and runtime-schema
contributions without central type switches.

#### Scenario: Extension adds an editable content type
- **WHEN** an extension registers a new editable content type
- **THEN** initialization MUST require every pipeline contribution needed for safe parse, edit, save, and output or reject the extension as incomplete

### Requirement: Feature bundles declare dependencies and conflicts
A feature bundle MUST declare stable identity, version compatibility,
dependencies, conflicts, replacements, required ports, and contributions.
Resolution SHALL be deterministic and independent of import order.

#### Scenario: Dependency cycle exists
- **WHEN** enabled feature bundles contain a dependency cycle
- **THEN** initialization MUST fail with a diagnostic naming the cycle before any document is opened

### Requirement: Runtime services are explicit ports
The engine MUST access environment-dependent fonts, shaping, images, clocks,
identity, persistence, transport, scheduling, audit, authorization, resource
accounting, cancellation, and external-resource consent only through declared
runtime ports.

#### Scenario: Worker lacks a DOM
- **WHEN** the engine initializes in a worker with non-DOM font and image ports
- **THEN** all enabled non-DOM capabilities MUST operate without importing browser globals

### Requirement: Package boundaries constrain dependencies
The semantic core MUST remain PM-free, DOM-free, transport-neutral, and
backend-neutral. Editor binding owns ProseMirror dependencies; synchronization
owns Yjs and transports; PDF owns PDF writing; server owns host integration;
generated language packages own only schema/RPC bindings.

#### Scenario: Base core dependency graph is inspected
- **WHEN** only document parse, semantic edit, and DOCX save are installed
- **THEN** ProseMirror, Yjs, transport, browser, and PDF dependencies MUST be absent from the required graph

### Requirement: Extensions preserve determinism and limits
Capability hooks MUST be deterministic for identical inputs, declare dependency
keys, honor cancellation and resource budgets, and avoid hidden global mutable
state. The engine SHALL reject or isolate hooks that violate declared limits.

#### Scenario: Hook exceeds resource budget
- **WHEN** an extension measurement hook exceeds its allotted time or memory
- **THEN** the operation MUST terminate with a resource-limit error and MUST NOT commit partial canonical state

### Requirement: Distribution gating does not enter core policy
The engine core MUST remain free of distribution policy. Optional or restricted features MAY be distributed as separate packages, but
the engine core MUST contain no entitlement, license-key, activation, or
degraded-mode branch. An installed compatible feature SHALL run fully.

#### Scenario: Optional package is absent
- **WHEN** an application does not install an output or collaboration package
- **THEN** its API and dependencies MUST be absent at build time rather than failing a runtime license check

### Requirement: Public extension entries are stable
The package MUST expose extension-authoring contracts, capability identifiers,
schema registration, and runtime ports through declared stable package entries.
Internal model layouts and experimental geometry MUST NOT become accidental
public API.

#### Scenario: Internal source path is imported
- **WHEN** an extension attempts to import an unexported implementation module
- **THEN** package resolution and CI policy MUST reject the import

### Requirement: Capability combinations are conformance-tested
The engine MUST test supported feature combinations, replacement behavior,
missing ports, absent optional features, and registration order across browser,
worker, and server runtimes.

#### Scenario: Same features use different registration order
- **WHEN** two configurations enable the same compatible bundles in different input order
- **THEN** the resolved registry, authored behavior, layout, and output MUST be equivalent

### Requirement: Capability and command IDs are globally stable
The registry MUST assign every extension, capability, command, query, schema, dependency key, runtime
port, and replacement target MUST use a reverse-domain or package-owned stable
ID plus version range. Registration MUST reject collisions unless one extension
declares an authorized replacement of the exact target and satisfies its
compatibility contract.

#### Scenario: Two packages register one command ID
- **WHEN** neither package declares an authorized replacement
- **THEN** initialization MUST fail with both package identities and MUST NOT select by registration order

### Requirement: Replacement precedence is deterministic
Replacement resolution MUST validate target version, replacement priority,
exclusive ownership, dependency closure, and transitive conflicts. Multiple
eligible replacements MUST fail unless a single deterministic winner is
declared by the replaced capability's policy.

#### Scenario: Replacement targets incompatible version
- **WHEN** a feature replaces a capability outside its supported range
- **THEN** initialization MUST fail before document open

### Requirement: Optional APIs use generated namespace augmentation
Optional API types MUST derive from installed schemas. Installed extension schemas MAY augment `DocxEditor.*` through generated
TypeScript namespace declarations and runtime registry entries. Absent packages
MUST contribute neither types nor runtime members. Extensions MUST NOT create
another object-model namespace or rely on handwritten declaration merging as
the schema source.

#### Scenario: Citation package is absent
- **WHEN** declarations are generated without the citation extension
- **THEN** citation-specific proxies and commands MUST be absent while base `DocxEditor.*` remains valid

### Requirement: Resource and cancellation ownership is explicit
Runtime ports MUST implement hierarchical reservation, release, abort
propagation, bounded checkpoints, overflow-safe counters, queue/spill cleanup,
and worker termination. Synchronous untrusted hooks MUST execute in terminable
isolation; cooperative hooks MUST declare maximum checkpoint interval.
Canonical publication SHALL be the point of no return: abort before publication
MUST roll back every canonical/backend effect; abort after publication MUST
return commit ID/revision and cancel only derived work. Every child budget,
queue, spill file, and worker MUST release before the root reservation.

#### Scenario: Extension ignores cancellation
- **WHEN** an isolated hook exceeds budget or ignores abort
- **THEN** its worker MUST be terminated, all reservations released, and no canonical transaction committed
