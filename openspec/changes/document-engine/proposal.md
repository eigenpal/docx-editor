## Why

The greenfield engine is currently described across several overlapping changes
whose contracts disagree on canonical state, synchronization currency, editor
binding, layout invalidation, and the public API. One authoritative change is
needed so implementation can proceed from a coherent, testable architecture.

## What Changes

- Define one authored, lossless OPC/OOXML package model as canonical state, with
  resolved styles/layout inputs held in fingerprinted derived caches carrying
  revision provenance.
- Separate semantic operations, committed model notifications, opaque
  replication updates, and snapshots into distinct contracts.
- Define one atomic replication coordinator for local commits and remote merges,
  with staged canonical/backend state, deterministic repair, rollback,
  commit/update IDs, state vectors, idempotence, and echo suppression.
- Make `DocumentStore` semantic and ProseMirror-free, keep CRDT details behind a
  replication backend, and make `EditorBinding` the only ProseMirror-aware layer.
- Define deterministic normalization, stable identity, edit-surviving anchors,
  atomic multi-story transactions, history, undo, persistence, and schema
  evolution.
- Define a dependency-aware layout pipeline and anchored display list that run
  identically in browser, worker, and server environments.
- Expose the familiar batched Office JavaScript-style API exclusively through
  the independently declared `DocxEditor.*` namespace, including headless use.
- Generate the qualified `DocxEditor.*` proxy IDL, semantic commands, runtime
  validators, MCP descriptors, RPC schemas, and language bindings from one
  schema-first source of truth.
- Unify document commands, agent-safe JSON operations, the object model, and
  browser editor commands over the same semantic mutation path.
- Define extension, runtime-port, Yjs synchronization, addressable-document,
  server-hub, citation, and language-binding boundaries.
- Establish explicit fidelity, security, convergence, performance, and
  cross-runtime conformance gates.
- Supersede the overlapping greenfield architecture changes after every
  requirement and unfinished task is accounted for in a migration ledger.

## Capabilities

### New Capabilities

- `lossless-package-model`: Bounded OPC/OOXML parsing, authored package state,
  preservation capsules, stable identities, and selective serialization.
- `semantic-document-store`: Semantic operations, model changes, transactions,
  normalization, anchors, history, undo, persistence, and replication seams.
- `editor-binding`: Bidirectional ProseMirror projection with operation mapping,
  reconciliation, IME, selection, and loop-prevention semantics.
- `layout-and-output`: Deterministic shaping, dependency-aware pagination,
  anchored display-list output, and browser/worker/server rendering.
- `docx-editor-object-model`: The `DocxEditor.*` request-context API, public
  entries, commands, queries, errors, and runtime schemas.
- `extensions-and-runtime-ports`: Feature registration, dependency resolution,
  runtime services, package boundaries, and output backends.
- `addressable-document-sync`: Yjs-backed replication, awareness, transports,
  offline replay, persistence, server hub, and security mechanics.
- `server-and-language-bindings`: ProseMirror-free server editing and export,
  revision isolation, RPC contracts, and generated language clients.
- `citations-and-annotations`: Durable comments, revisions, citations, source
  metadata, navigation, and edit-surviving attachment semantics.
- `engine-performance-and-conformance`: Large-document budgets, bounded
  incremental work, fidelity fixtures, fuzzing, and cross-runtime/backend gates.

### Modified Capabilities

None. This is a greenfield engine contract; existing adapter and fidelity
capabilities remain independent delivery changes.

## Impact

- **Architecture:** one canonical authored model; ProseMirror and display lists
  are projections; local and Yjs stores share one semantic contract.
- **Public API:** applications use `DocxEditor.*`; no alternate branded
  namespace or alias is declared.
- **Packages:** defines responsibilities for core, editor binding, extensions,
  synchronization, server execution, output backends, and generated SDKs.
- **Dependencies:** confines XML, shaping, PDF, Yjs, transport, and runtime
  dependencies to their owning packages.
- **Migration:** absorbs `modular-core-api`, `ooxml-document-pipeline`,
  `chromium-free-rendering-engine`, `remote-document-sync`, and
  `core-api-contract`; the completed `engine-core-spike` KISS browser POC and
  `spike-architecture-decision.md` are prerequisite evidence. Production
  implementation and conformance remain owned entirely by this change.
