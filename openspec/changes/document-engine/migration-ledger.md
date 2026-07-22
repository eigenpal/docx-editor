# Document Engine Migration Ledger

## Purpose and classification

This ledger accounts for proposal statements, design decisions, requirements,
scenarios, open questions, and unfinished tasks in the source changes. Scenario
groups map with their parent requirement unless a correction is called out.

- **migrated**: retained with equivalent intent in the named destination.
- **corrected**: retained after resolving a contradiction or unsafe claim.
- **retired**: intentionally removed and not an implementation requirement.
- **deferred**: valid work assigned to a later named milestone or conformance
  gate.
- **already implemented**: source task reports completion; retained only as a
  baseline or compatibility input.

The production authority is `document-engine/design.md` plus the ten capability
specifications. `engine-core-spike` remains an independent prerequisite and is
strengthened separately as a fifteen-gate falsification change.

## Cross-source contradiction resolution

- **corrected** — Canonical office-shaped/resolved tree claims from
  `modular-core-api` and `ooxml-document-pipeline` are replaced by the authored,
  lossless OPC/OOXML package model in design D1 and
  `lossless-package-model` requirements "Authored package state is canonical"
  and "Unsupported content is preserved".
- **corrected** — The "one currency" claims are replaced by the four contracts
  in design D2 and `semantic-document-store` requirement "Four distinct state
  contracts".
- **corrected** — A CRDT-as-store or PM-shaped replication claim is replaced by
  semantic `DocumentStore`, PM-free `ReplicatedStoreBackend`, model-shaped Yjs,
  and PM-only `EditorBinding` in design D2/D5 and the store, binding, and sync
  specs.
- **corrected** — Directly changed-block-only relayout is replaced by dependency
  closure plus pagination restart until convergence in design D6 and
  `layout-and-output`.
- **corrected** — Source-compatible branded API naming is replaced by an
  independently declared API exposed only through `DocxEditor.*` in design D8
  and `docx-editor-object-model`.
- **corrected** — Structural block-index and optional-offset addressing is
  replaced by JSON-safe external targets and internal edit-surviving anchors;
  paragraph indices are non-canonical. See design D4 and
  `semantic-document-store`.
- **corrected** — Sync security being out of scope is replaced by mandatory
  authentication, authorization, isolation, limits, malformed-input handling,
  audit, and no-fetch mechanics in design D10/D14 and
  `addressable-document-sync`.
- **corrected** — A second CRDT backend as an immediate promise is replaced by a
  later conformance-gated candidate in design D2 and
  `addressable-document-sync`.

## `modular-core-api`

### `proposal.md`

- **migrated** — Batched `run`/request-context/proxy/load/sync public surface,
  lazy reads, queued writes, and client/server/worker execution ->
  `docx-editor-object-model` requirements "Batched request contexts and lazy
  proxies" and "Proxies, collections, results, and insertion semantics".
- **corrected** — Source-compatibility framing -> design D8 and the exclusive
  `DocxEditor.*` requirement; behavior follows familiar Office
  JavaScript-style semantics without a branded alias or drop-in claim.
- **migrated** — Runtime metrics/font/image adapters and environment-neutral
  execution -> design D9 and `extensions-and-runtime-ports` requirements
  "Runtime services are explicit ports" and "Package boundaries constrain
  dependencies".
- **migrated** — One positioned IR for DOM, PDF, print, and hit testing ->
  design D7 and `layout-and-output` requirements "Display items carry final
  geometry and anchors" and "Output backends share one display list".
- **migrated** — Capability registry and vertical feature bundles ->
  design D9 and `extensions-and-runtime-ports`.
- **corrected** — Always-current model plus `apply`/`subscribe`/`encode`/`merge`
  store seam -> authored model and separate semantic store/replication contracts
  in design D1-D3 and `semantic-document-store`.
- **migrated** — Distribution-only feature gating, complete base DOCX editing,
  no core licensing -> design D9 and "Distribution gating does not enter core
  policy".
- **corrected** — Proposed package topology -> responsibility-based boundaries
  in `extensions-and-runtime-ports`; exact package extraction and version groups
  remain implementation sequencing, not canonical model behavior.
- **migrated** — Object-model, runtime-port, display-list, capability-registry,
  and document-store capability intents -> corresponding consolidated specs.
- **retired** — "Interface-only, no runtime behavior" scope -> this consolidated
  change specifies production implementation behavior and gates.

### `design.md`

- **migrated** — D1 batched proxy model, one relayout per sync, tracked proxy
  lifetime, collections/results, insert semantics -> design D8 and
  `docx-editor-object-model`.
- **migrated** — D2 ports and browser-free headless adapters -> design D7/D9,
  `layout-and-output`, and `extensions-and-runtime-ports`.
- **migrated** — D3 immutable positioned display items and output backends ->
  design D7 and `layout-and-output`.
- **corrected** — D3 opaque feature anchor payload -> display items carry typed
  internal document anchors and semantic roles in
  `layout-and-output`; extension payloads remain schema-owned.
- **migrated** — D4 registry replacing central type switches, feature metadata,
  one public extensions list, dependency resolution, replacements, and
  tree-shakable optional features -> design D9 and
  `extensions-and-runtime-ports`.
- **corrected** — D5 canonical store, replication, editor binding, one-currency
  claim, history replacement, and direct CRDT store implementation -> design
  D1-D5 and the store, binding, and sync specs.
- **migrated** — D6 feature/format/runtime orthogonality and headless as an
  execution property -> design D9 and package-boundary requirements.
- **migrated** — D7 distribution gating and absent-feature build-time surface ->
  design D9, `extensions-and-runtime-ports`, and object-model feature coverage.
- **migrated** — Risks for stale proxies and deterministic metrics -> revision-
  aware sync in design D8/D11 and cross-runtime conformance in performance spec.
- **migrated** — Fallback-font licensing risk -> design open question assigned
  to shaping milestone and cross-runtime resource requirements.
- **deferred** — Package fixed-version-group choice -> package extraction
  milestone; does not alter engine semantics.
- **migrated** — Per-feature metadata typing question -> extension schemas and
  capability-owned versioned metadata in `extensions-and-runtime-ports`.
- **migrated** — Selective-save registry question -> capability registry plus
  `lossless-package-model` "Selective and complete serialization".
- **deferred** — Redistributable fallback-font selection -> shaping milestone
  under design Open Questions.
- **corrected** — Compatibility-strength question -> settled as exclusive
  `DocxEditor.*` with familiar semantics, no alias.
- **deferred** — Hosted PDF deployment option -> server deployment choice;
  native PDF over IR remains required in `layout-and-output`.
- **migrated** — Additive interface-first migration order -> expanded dependency
  sequence in design Migration Plan.

## `ooxml-document-pipeline`

### `proposal.md`

- **corrected** — One hardened, observable OOXML ingestion path, order/lexical
  fidelity, and capability-owned parsing migrate to `lossless-package-model`
  and design D14; the source's concrete parser-library selection is retired as
  implementation detail.
- **corrected** — Plain canonical model carrying resolved values -> authored
  package model plus fingerprinted derived caches with revision provenance in design D1 and
  `lossless-package-model`.
- **corrected** — CRDT backing store and PM binding analogy -> separate semantic
  store, model-shaped Yjs backend, and EditorBinding in design D2/D5.
- **corrected** — Only changed blocks invalidate layout -> dependency closure and
  pagination convergence in design D6 and `layout-and-output`.
- **corrected** — Branded public API shape -> exclusive `DocxEditor.*` in design
  D8 and object-model spec.
- **corrected** — `DocOp` as undo/sync/persistence currency -> four contracts in
  semantic-store spec.
- **migrated** — Parse, model, layout/pagination, and object-model capability
  intents -> lossless model, semantic store, layout/output, and object-model
  specs.
- **migrated** — No browser XML parser, no editor/DOM dependency on server,
  hardened package input -> lossless, server, and security requirements.

### `design.md`

- **corrected** — Canonical `DocumentStore` interface including
  `encode`/`merge` -> semantic `DocumentStore` and separate
  `ReplicatedStoreBackend`.
- **migrated** — End-to-end package-to-store-to-layout-to-output pipeline ->
  consolidated design Context and D1-D7.
- **corrected** — Model seed skipping unsupported unregistered content ->
  unsupported material MUST be preserved in capsules even when not semantically
  interpreted; see lossless package spec.
- **migrated** — XML fidelity settings and bounded reader rationale ->
  lossless package ingestion and trust-boundary requirements. Exact parser
  option names become implementation detail; observable preservation is
  normative.
- **migrated** — Capability parsers sanitize URLs/CSS, refuse automatic external
  fetches, and keep fields inert -> design D14 and lossless security requirement.
- **corrected** — Model carries resolved style chains and object-model names ->
  authored model plus derived caches and proxy facade in design D1/D8.
- **corrected** — Every mutation/notification/propagation uses one operation ->
  design D2-D3 and semantic store.
- **migrated** — PM as projection, forward and reverse mapping, no server PM ->
  design D5 and `editor-binding`.
- **migrated** — Risks for whitespace/coercion, verbose parser output, and
  structural sharing -> lossless fixtures and performance/conformance gates.
- **migrated** — `DocOp` granularity question -> capability-owned semantic
  vocabulary; exact operation set is an implementation task under semantic
  store conformance.
- **deferred** — Streaming versus full parse by XML part -> package-model
  milestone, bounded by streaming and memory requirements in performance spec.
- **corrected** — Raw-versus-resolved style question -> authored raw/omitted
  canonical values and resolved revision caches, settled in design D1.
- **corrected** — Public surface breadth question -> required feature subset is
  explicit in `docx-editor-object-model`, expanded through stable schemas.

### `specs/ooxml-parse-boundary/spec.md`

- **corrected** — Observable single-path browser/server XML behavior is retained
  by lossless ingestion and headless execution; the concrete parser library and
  "sole library" mandate are retired as implementation detail.
- **migrated** — Order, whitespace, and zero-padded lexical-value scenarios ->
  lossless fidelity requirement and package fidelity conformance.
- **migrated** — DTD/external-entity, entity-expansion, zip ratio/size, and path
  safety scenarios -> lossless bounded trust boundary and malicious fixture
  suite.
- **corrected** — Model construction only through capability parsers and
  unregistered elements skipped -> parser ownership retained, but unknown
  content is preserved in capsules instead of discarded.
- **migrated** — URL sanitization, external relationship no-fetch, and inert
  field scenarios -> lossless safe relationships requirement and design D14.

### `specs/canonical-document-model/spec.md`

- **corrected** — Canonical always-current model scenarios -> canonical authored
  package state, not a resolved object-model-shaped tree.
- **corrected** — `apply` only path and operation crossing process boundary ->
  all semantic writes use `DocOp`; remote wire updates and snapshots remain
  distinct.
- **corrected** — Block-level notification and unchanged-reference scenarios ->
  `ModelChange` carries dirty identities and dependencies; bounded work is
  measured rather than guaranteed by object reference alone.
- **corrected** — Local op-log versus CRDT implementation as interchangeable
  stores -> shared semantic store behavior over separate local/Yjs replicated
  backends.
- **corrected** — Storage tree mirrors public object model -> public proxies are
  a facade over authored package state.
- **migrated** — PM-free and DOM-free canonical data plus server construction ->
  semantic store, editor-binding boundary, and server spec.

### `specs/layout-pagination-pipeline/spec.md`

- **migrated** — Stage pipeline over model/ports and no browser/editor
  dependency -> design D6-D7 and `layout-and-output`.
- **migrated** — Deterministic measurement, explicit advances, and no browser
  font stack -> browser-free shaping requirement.
- **migrated** — Sections, columns, table splitting, repeated headers, and
  header/footer geometry -> layout structure requirement.
- **migrated** — Second-pass page numbers, references, contents, and notes ->
  pagination convergence and page-dependent resolution.
- **migrated** — One IR for DOM/PDF/print/hit-test -> common display-list output.
- **corrected** — PM projection plus remeasure only named blocks -> EditorBinding
  retained; invalidation expands through dependencies and paginates to
  convergence.
- **migrated** — Server parse/store/layout/output with no editor -> server
  headless requirement.

### `specs/office-compatible-object-model/spec.md`

- **corrected** — Branded names/types and add-in source scenarios -> exclusive
  `DocxEditor.*`, batched proxies, collections, results, and insertion semantics.
- **migrated** — No dependency on external add-in package -> independently
  declared public API and package-boundary requirements.
- **corrected** — Proxy reads current model, mutations queue operations, sync
  reconciles remote changes -> authored proxy facade and revision-aware atomic
  sync.
- **migrated** — Same code in browser/worker/server -> object-model and server
  specs.
- **migrated** — Feature members absent when package absent -> extension
  distribution gating and type-surface requirements.

## `chromium-free-rendering-engine`

### `proposal.md`

- **migrated** — Browser is not the layout oracle; identical browser/worker/
  server inputs yield deterministic output -> design D7 and layout shaping/
  output requirements.
- **migrated** — Font-byte shaping for advances, kerning, ligatures, clusters,
  bidi, embedded fonts, and fallback -> browser-free shaping.
- **corrected** — PM handles undo -> EditorBinding handles projection while the
  store/backend history contract provides behaviorally consistent undo.
- **migrated** — PM/DOM-independent model layout and headless pipeline ->
  semantic store, layout, and server specs.
- **migrated** — Immutable positioned IR, model-owned geometry, explicit
  justification/text fit -> anchored display-list requirements.
- **migrated** — Native PDF font embedding/subsetting, glyph placement, links,
  transforms, and clipping -> native PDF requirement.
- **migrated** — Page-dependent second pass -> pagination convergence.
- **migrated** — Heavy shaping/PDF dependencies confined to owning packages ->
  package-boundary requirements.
- **corrected** — Near-reference fidelity with no explicit acceptance ->
  representative cross-runtime and package/output conformance with ratified
  thresholds and equivalence metrics.
- **migrated** — Golden image and metrics parity harness -> performance and
  conformance spec.

## `remote-document-sync`

### `proposal.md`

- **migrated** — Resolvable address shared by browser and server, server as
  headless editor, live fan-out -> design D10-D11 and sync hub requirements.
- **corrected** — All change as commutative binary delta -> semantic changes are
  `DocOp`s inside the store; only replication updates are opaque mergeable bytes.
- **corrected** — Combined CRDT/backend/editor seam and direct editor bindings ->
  three boundaries, model-shaped Yjs, EditorBinding-only PM mapping.
- **migrated** — Syncable content/comments/revisions in replicated state and all
  cross-references use durable anchors -> sync and annotation specs.
- **migrated** — Remote extension lifecycle, URL resolution, initial sync,
  streaming, offline replay -> addressable sync requirements.
- **migrated** — WebSocket and SSE+POST transport seam -> transport requirement.
- **migrated** — Hub apply/observe/edit/export/persist -> hub lifecycle and
  server specs.
- **corrected** — Immediate second-backend support -> later conformance gate.
- **corrected** — Security out of scope -> mandatory mechanics in sync and
  server requirements; integration still supplies policy through ports/hooks.

### `design.md`

- **migrated** — D1 separation of semantic store, replicated backend, and editor
  binding -> design D2/D5 and corresponding three specs.
- **migrated** — Local neutrality backend, model-shaped Yjs, relative anchors,
  explicit marks/tables/parts/capsules -> sync and semantic-store requirements.
- **migrated** — D2 all durable syncable state replicated and cross-references
  anchored -> sync and annotation specs.
- **migrated** — D3 URL/auth/transport/offline lifecycle -> addressable URL and
  offline replay requirements.
- **migrated** — D4 opaque transport interfaces, statuses, WebSocket, and
  SSE+POST -> transport requirement. Managed transport is allowed through the
  seam but not required.
- **corrected** — D5 hub using a combined CRDT backend -> hub uses semantic
  `DocxEditor.*` over the store and separate replicated backend.
- **migrated** — Risks for rebroadcast storms, offline divergence, and non-hot
  backend choice -> origin/idempotence, batching, convergence, and migration
  requirements.
- **migrated** — Persistence cadence/log/snapshot question -> versioned
  persistence is required; numeric cadence and retention are ratified at the
  persistence milestone.
- **migrated** — Awareness/presence question -> required as ephemeral,
  authorized, bounded awareness.
- **migrated** — Subscribe-only viewers question -> authorization may grant
  read/update-stream without write; transport semantics cover the role.
- **deferred** — Delta coalescing parameter defaults -> persistence/performance
  milestone, subject to measured baselines and no data-loss invariants.
- **corrected** — Migration plan naming a combined backend -> local/Yjs semantic
  conformance first, transports second, hub/persistence third, any later backend
  only after conformance.

## `core-api-contract`

### `proposal.md`

- **already implemented** — Private contract-only package scaffold and six
  entries are reported complete in source tasks; its bare declarations are
  migration inventory only, not an authoritative production API baseline.
- **corrected** — Exactly six permanent entries -> stable audience-specific
  entries remain, while the temporary geometry entry has an explicit retirement
  path and styles/assets may require declared exports.
- **migrated** — JSON-safe paragraph ID plus unique phrase, ambiguity failure ->
  external target layer in design D4 and semantic-store target requirement.
- **corrected** — Structural block indices and character offsets for other
  content -> story/container identity plus unique external location resolved to
  internal structural/backend-relative anchors; indices are never canonical.
- **migrated** — Open declaration-merged commands and runtime schemas ->
  common API registries and extension capability specs.
- **migrated** — Detailed write result taxonomy -> object-model error taxonomy.
- **corrected** — Adapter-supplied measurement in EditorHost -> runtime ports own
  deterministic shaping/measurement; EditorHost supplies available adapter
  runtime integration and scheduling, not canonical geometry.
- **migrated** — Explicit body/header/footer scope -> object-model scope
  requirement.
- **migrated** — No public shared-cache invalidation; instance relayout instead
  -> object-model and runtime-port boundaries.
- **already implemented** — Removal of the parallel design-doc tree is reported
  complete except remaining references; architecture records stay in OpenSpec.
- **migrated** — Adapter and agent adoption postponed until engine exists ->
  consolidated design migration steps 6 and 10.

### `design.md`

- **migrated** — Separate document, adapter, and extension audiences -> stable
  entry and package-boundary requirements.
- **migrated** — Engine paints hosted surfaces, adapter supplies lifecycle ->
  EditorHost versus EditorBinding distinction in design Context/D8.
- **migrated** — Wire-safe commands/positions -> common JSON schemas and
  two-layer anchors.
- **corrected** — Six-entry map -> preserve intended audience split while
  allowing required assets and retiring experimental geometry by milestone.
- **corrected** — Phrase addressing and structural paths -> two-layer resolver,
  ambiguity errors, no canonical indices.
- **migrated** — Open commands and runtime schemas -> object-model and extension
  registries.
- **migrated** — `ExecResult`, query versus snapshot, and non-colliding snapshot
  naming intent -> explicit result/query contracts; concrete type naming remains
  under `DocxEditor.*`.
- **corrected** — Host-injected block measurement -> deterministic runtime ports
  are engine inputs; two-phase host scheduling and late DOM getters remain
  adapter responsibilities.
- **migrated** — Explicit scopes and no public cache reset -> object-model scope
  and instance lifecycle requirements.
- **migrated** — Risks around private publication, geometry calcification,
  declaration discoverability, and cross-package sequencing -> public-entry CI,
  geometry retirement, schema registry, and migration plan.
- **deferred** — Measurement-port permanence question -> resolved
  architecturally as explicit runtime ports; the exact adapter convenience API
  is decided during adapter migration.
- **deferred** — Shared toolbar/widget package placement -> adapter migration;
  not an engine semantic requirement.
- **migrated** — Automation entry transports-versus-schemas question -> core
  owns schemas/registries; hosts own MCP/RPC transport.
- **deferred** — Retired deprecation duration -> at least the declared
  compatibility window, finalized during release migration.
- **migrated** — Current-page default ambiguity -> queries MUST require or
  document explicit caret-versus-viewport mode before stable release.

### `specs/core-public-api/spec.md`

- **corrected** — Exactly six entry points -> stable entry responsibilities,
  temporary experimental geometry retirement, and any required asset exports.
- **migrated** — Declared imports resolve without aliases and undeclared imports
  fail -> object-model public-entry requirement.
- **migrated** — No source-path resolution -> package-boundary requirements.
- **migrated** — Stable versus experimental semver behavior -> public entry
  stability requirement.
- **already implemented** — Contract package `private: true` baseline.
- **migrated** — Release workflow must exclude contract package -> unfinished
  task mapped below to production migration verification.
- **migrated** — External entry deprecation window -> design migration step 10
  and public entry requirement.

### `specs/core-doc-addressing/spec.md`

- **migrated** — Paragraph ID matching, missing target, unique phrase, ambiguous
  failure, and explicit disambiguation scenarios -> external resolver.
- **corrected** — Structural path/index/offset for header and nested table
  content -> external story/container target resolved to stable internal
  identities and relative anchors; out-of-bounds remains a typed result.
- **migrated** — JSON-safe address crossing process boundaries -> external
  target requirement.

### `specs/core-command-vocabulary/spec.md`

- **migrated** — Open interface commands and unsupported handling -> common
  registry and extension capability requirements.
- **migrated** — JSON-safe command objects and binary transport projection ->
  object-model runtime schemas and server streaming/reference contracts.
- **migrated** — Runtime JSON Schemas and extension schema registration ->
  common schema registry.
- **migrated** — Detailed write result taxonomy and changed/no-op distinction ->
  object-model result taxonomy.
- **corrected** — Positionally aligned independent batch results -> each result
  remains aligned, but atomic transaction policy MUST state whether any failure
  aborts the batch; no partial package-invalid commit is allowed.
- **migrated** — Explicit tracked-change author, no hidden global toggle ->
  object-model feature operations and annotation tracked-change requirement.

### `specs/core-editor-host/spec.md`

- **migrated** — Late/current DOM getters and changing scroll container ->
  object-model EditorHost requirement.
- **migrated** — Coalescing schedule and post-adapter-commit phase -> EditorHost
  runtime lifecycle and bounded edit scheduling.
- **corrected** — Synchronous headless host -> true headless execution does not
  need an EditorHost; synchronous scheduling remains an available runtime port.
- **corrected** — Host supplies every block measurement -> shaping/layout own
  deterministic measurement through runtime ports; adapters may provide a port,
  never a second geometry oracle.
- **migrated** — N+1 story scopes, active/explicit/all read semantics ->
  object-model scope.
- **migrated** — Relayout instead of shared cache reset; multiple editors remain
  isolated; font load invalidation is engine-owned -> runtime ports, model
  revisions, and instance-level layout requirements.

### `tasks.md`

- **already implemented** — 1.1 through 1.10 contract package scaffold,
  declarations, entries, typecheck, rationale, and changeset exclusion.
- **migrated** — 1.11 release-workflow non-publication assertion -> migration
  milestone public-entry/release verification.
- **already implemented** — 2.2 parallel docs tree deletion.
- **migrated** — 2.3 stale-reference removal -> repository guidance alignment
  during source retirement, outside these markdown artifacts.
- **migrated** — 3.1 undeclared core-subpath CI lint -> public-entry conformance.
- **already implemented** — 3.2 consumer type test baseline; it MUST be expanded
  for `DocxEditor.*` and runtime schemas.
- **migrated** — 3.3 no path mapping or bundler alias -> public-entry
  conformance.
- **migrated** — 4.1 production implementation of stable entries -> entire
  document-engine implementation sequence.
- **migrated** — 4.2 reconcile adapter imports -> adapter migration milestone.
- **migrated** — 4.3 export shared stylesheet and preset/assets -> public entry
  and adapter migration milestone.
- **migrated** — 4.4 retired aliases for one major -> compatibility migration;
  aliases MUST NOT introduce an alternate public object-model namespace.
- **migrated** — 5.1 shared engine consolidation -> this document-engine change.
- **migrated** — 5.2 agent package first -> common command/schema milestone and
  adapter adoption sequence.
- **migrated** — 5.3 React/Vue entry migration -> adapter migration after engine
  conformance.
- **migrated** — 5.4 shrink experimental geometry with milestones -> anchored
  display-list adapter adoption.
- **deferred** — 5.5 toolbar/widget placement -> adapter-owned packaging decision
  during migration.

## `engine-core-spike`

The spike remains independent. Its artifacts are accounted for so the
production change depends on its explicitly strengthened fifteen-gate risk
boundary.

### `proposal.md`

- **migrated** — Authored lossless package model and derived resolved caches ->
  production design D1 and lossless spec; spike proves the narrow slice.
- **migrated** — Four contracts and PM-free three-boundary architecture ->
  production design D2/D5 and store/binding/sync specs.
- **migrated** — First-class operation mapper, unsupported fallback,
  normalization, reverse reconciliation, origins, and loops -> editor-binding.
- **migrated** — Stable identities, compound anchors, and atomic multi-story
  transactions -> semantic store and lossless model.
- **migrated** — Dependency-aware layout and pagination restart -> layout/output.
- **migrated** — Revision-aware server contexts -> server/language bindings.
- **migrated** — Mandatory security mechanics -> design D10/D14, sync, server,
  and performance security conformance.
- **migrated** — Narrow one-story/text/local+Yjs spike scope and architecture
  falsification intent -> prerequisite step 1 in design Migration Plan.
- **migrated** — Later backend only through conformance -> sync and performance
  specs.

### `design.md`

- **migrated** — R1/R2 authored package model, preservation capsules, authored
  omission/raw values, resolved revision caches -> design D1 and lossless spec.
- **migrated** — R3 four named contracts, semantic audit log, update compaction,
  and full snapshot distinction -> design D2 and explicit semantic/sync
  requirements for audit records, snapshot payload, and restore.
- **migrated** — R4 semantic store, replicated backend, EditorBinding-only PM ->
  design D2/D5 and three capability specs.
- **migrated** — R5 Yjs stable-ID records, collaborative text, explicit marks,
  normalized tables, sibling package maps, significant order, capsules, and
  deterministic repair -> addressable sync and semantic normalization.
- **migrated** — R6 mapper extensibility, fallback replacement, disabled unsafe
  commands, reverse mapping, all selection kinds, IME, origins, loops ->
  editor-binding.
- **migrated** — R7 one validate/apply/repair/notify path and no post-commit PM
  semantics -> semantic store and editor binding.
- **migrated** — R8 stable ID rules, compound anchors, atomic multi-story/part
  transactions -> lossless model and semantic store.
- **migrated** — R9 dependency closure and pagination convergence ->
  layout/output.
- **migrated** — R10 anchored display items and revision/precondition-aware
  server contexts -> layout/output and server specs.
- **migrated** — R11 auth/authz, limits, tenant isolation, malformed update,
  audit, and no external loads -> sync/server/security conformance.
- **migrated** — Spike gates for local operations, model-first commit,
  two-client convergence, headless edit, caret-before insertion, caret deletion,
  IME, per-user undo, model-only layout parity, and authored export/reopen ->
  editor-binding, store, layout, lossless, and conformance acceptance suites.
- **migrated** — Strengthened gates for selective capsule preservation,
  browser/server schema-command parity, concurrent annotation anchors,
  origin/awareness separation, and bounded large-document edit work ->
  lossless, object-model, annotation, sync, binding, and performance
  conformance suites.
- **migrated** — Spike parity and fuzz harness -> binding and collaboration
  conformance requirements.
- **migrated** — Post-spike sequence paste/lists, tables, multi-story/package,
  full OOXML -> consolidated design Migration Plan.
- **deferred** — Exact Yjs table and mark record shapes -> spike selects shapes;
  production invariant is model-shaped state in sync spec.
- **deferred** — Undo mechanism choice -> spike must select an implementation;
  behavior is fixed in semantic-store requirements.
- **migrated** — Persistence/schema-evolution question -> required before
  durable addressable documents in store and sync specs.
- **deferred** — Snapshot cadence, compaction, and garbage-collection defaults
  -> persistence/performance milestone, with recoverability requirements already
  normative.

## Retired test retirement and redevelopment gates

- **retired** — Retired Playwright browser suites and old-core-coupled package
  test source are no longer authoritative implementation input. Under the
  normative production authority of `document-engine/design.md` and its
  capability specifications, their surviving behavioral obligations are
  cataloged in
  `spike/engine-core-spike-harness/migration/playwright-inventory.v1.json`,
  `spike/engine-core-spike-harness/migration/package-test-inventory.v1.json`,
  and applicable OpenSpec requirements. `engine-core-spike` remains only the
  independent prerequisite defined above.
- **retired** — Inventory entries marked implementation-only have no replacement
  requirement. They remain tombstones and migration audit input, not future
  conformance obligations.
- **deferred** — Browser reference research is deferred. If later observations
  are captured, they serve only as corroborating fixture evidence and MUST NOT
  override the normative `document-engine` design or capability requirements.
- **deferred** — Future browser redevelopment is governed by the normative
  `document-engine` design and capability specifications. OOXML and
  OpenSpec-authored expected-output fixtures/comparators are evidence inputs
  under that authority, alongside a public engine-neutral
  `EditorDriver`/`DocxEditor.*` transport, stable command/query assertions, and
  `DisplayItem`/export comparators rather than internal DOM or ProseMirror
  geometry checks.
- **deferred** — No browser E2E command may return before an engine-neutral driver
  exists; until then the inventories, schema-backed commands, and non-browser
  comparators carry the surviving obligations.

## Current-stack authority boundary

- **retained outside consolidation** — `engine-spine-tier2` remains a
  current-stack delivery change and is neither absorbed nor deleted.
- **corrected authority** — Its `DocxEditorEngine` name describes current-stack
  orchestration only. It is not the greenfield `DocxEditor.*` object model and
  is non-authoritative for the target API.
- **corrected boundary** — PM-bearing current host methods are retired delivery
  detail. Future `EditorHost` is PM-free; only `EditorBinding` may depend on
  ProseMirror.
- **verification destination** — production tasks 0.5, 6.1, 7.12, and 14.5
  prevent current-stack orchestration and host internals from leaking into
  target declarations or packages.

## First-round correction evidence

- **corrected** — Replication coordination now defines local/remote staging,
  rollback, repair propagation, IDs/state vectors, revisions, idempotence, and
  echo suppression.
- **corrected** — Transactions are explicit and synchronous; public batches are
  all-or-nothing with positional failing/aborted results.
- **corrected** — Binding uses shadow state, identity-preserving content
  fallback, before/after evidence, typed origins, executable IME/selection/undo,
  and opaque anchors.
- **corrected** — Yjs schema, snapshots, transport barrier/ack/retry/queues,
  compaction gaps, viewer role, and auth refresh have normative destinations.
- **corrected** — Lossless I/O covers normalized OPC names, same-part ownership,
  relationships/content types, raw versus sink URLs, QName/value handling,
  capsule namespaces, CSS/DOM sinks, hard limits, and a combined fixture.
- **corrected** — Layout/performance defines shaping inputs, epochs,
  convergence, semantic tree, clusters, justification/text fit, comparators,
  frozen benchmarks, bounded counters, and budget/cancellation cleanup.
- **corrected** — The API defines qualified `DocxEditor.*` factories/types,
  schema-first IDL, lifecycle, targets, errors, feature/lock matrix, host timing,
  scopes, exports, and one-major forwarding.
- **corrected** — The narrow spike freezes capsule oracle, toy shaping,
  dependency edit, convergence fingerprint/pass bound, and fixture ceilings.

## Source-retirement evidence checklist

Retirement evidence is recorded only where it exists:

- [x] The first independent review panel reviewed the complete source proposals,
      designs, requirements/scenarios, open questions, and unfinished tasks before
      deletion; this ledger records their statuses and destinations.
- [x] `chromium-free-rendering-engine`, `core-api-contract`,
      `modular-core-api`, `ooxml-document-pipeline`, and `remote-document-sync`
      source directories were removed only after that review.
- [x] Strict validation passed for both corrected changes after this final
      correction pass.
- [x] Prohibited-term and stale-authority scans passed after this final
      correction pass.
- [x] OpenSpec discovery after removal shows only `engine-core-spike` and
      `document-engine` among those selected greenfield consolidation changes.
- [x] The current-stack `engine-spine-tier2` authority boundary remains explicit
      and unabsorbed.
- [ ] Post-fix independent verification reports no remaining applicable
      Blocker/High issue.

The final completeness/no-blocker gate MUST remain unchecked until post-fix
independent verification occurs.
