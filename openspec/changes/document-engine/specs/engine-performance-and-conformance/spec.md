## ADDED Requirements

### Requirement: Representative large-document classes are defined
The benchmark corpus SHALL include reproducible 300–500-page document classes
covering long styled text, lists/numbering, dense tables, images, sections,
headers/footers, fields, comments, tracked changes, citations, and documents
with 100 or more revisions. Fixture generators and hashes MUST be versioned.

#### Scenario: Benchmark corpus is reviewed
- **WHEN** an implementation milestone proposes performance acceptance
- **THEN** results MUST cover each representative class and identify fixture version and feature mix

### Requirement: Measurement methodology is explicit
Each benchmark MUST record runtime and engine versions, hardware, operating
environment, font/resource identities, warm or cold state, fixture hash,
operation and edit location, dependency closure, phase timings, bytes
read/written, peak and retained memory, output size, and repetition statistics.

#### Scenario: Two benchmark runs are compared
- **WHEN** a regression report compares builds
- **THEN** it MUST use equivalent methodology or disclose every changed variable that prevents direct comparison

### Requirement: Thresholds are ratified from baselines
The project MUST ratify thresholds for parse/open, first useful layout, bounded
incremental edit, pagination, sync, selective save, full save, DOCX export, PDF
export, and peak/retained memory before their implementation milestone is accepted.
Where no source contract establishes a number, this specification MUST NOT
invent one; maintainers SHALL approve thresholds from recorded baselines and
user-representative workloads.

#### Scenario: Milestone has no approved budget
- **WHEN** implementation is functionally complete but its required latency or memory threshold remains unratified
- **THEN** the milestone MUST remain unaccepted and the baseline data MUST be retained for decision

### Requirement: Bounded edits avoid whole-document hot paths
For a bounded local edit whose dependency closure is bounded, the hot path MUST
NOT project, clone, diff, serialize, parse, or walk the whole document; rebuild
the entire ProseMirror projection or DOM; or allocate work proportional to total
document size except for downstream pagination until convergence.

#### Scenario: Edit near document end
- **WHEN** one paragraph near the end of a representative document changes without global dependencies
- **THEN** instrumentation MUST show bounded semantic, binding, cache, and measurement work plus only the required pagination convergence range

### Requirement: Reads and outputs support bounded streaming
The engine MUST support bounded streaming or chunking for package ingestion,
large XML parts where selected strategy permits, media, snapshots, update logs,
queries, DOCX save, and PDF export when full buffering is unnecessary. Backpressure, cancellation,
integrity, and resource limits MUST be tested.

#### Scenario: Large media package opens
- **WHEN** a document contains media larger than the configured in-memory chunk budget
- **THEN** opening MUST stream or spool within limits and MUST NOT duplicate all media bytes in memory

### Requirement: Package fidelity conformance is enforced
Conformance MUST include authored omission/raw-value fixtures, unsupported
capsules, package-part diffs, selective save, create-from-scratch, all supported
stories and structures, XML escaping, and reopen equivalence.

#### Scenario: Untouched package parts are compared
- **WHEN** a fixture receives a localized semantic edit and selective save
- **THEN** eligible untouched parts MUST be byte-identical and changed parts MUST satisfy semantic and XML validity checks

### Requirement: Security conformance uses malicious fixtures
The suite MUST test zip bombs and traversal, unsafe XML, excessive depth/counts,
unsafe URLs and zero-click fetches, XML injection, prototype pollution,
malformed replication updates, oversized snapshots, inert fields/OLE, and
server tenant isolation.

#### Scenario: Malicious corpus is run
- **WHEN** every malicious fixture is opened, synchronized, laid out, or exported as applicable
- **THEN** it MUST fail safely within resource limits, perform no prohibited external access, and leave no partial committed state

### Requirement: Store and collaboration conformance is shared
Local and Yjs backends MUST pass identical semantic operations, normalization,
stable identity, anchors, history, solo/collaborative undo behavior, snapshot,
migration, and model-change tests. Yjs MUST additionally pass two-client
convergence, awareness, reconnect, offline replay, and compaction tests.

#### Scenario: Random concurrent operations
- **WHEN** randomized valid and conflicting operations are delivered in different orders to two clients
- **THEN** both MUST converge on equivalent normalized authored state, anchors, and durable annotations

### Requirement: Binding and runtime conformance is cross-platform
Golden and fuzz tests MUST cover forward mapping, reverse reconciliation,
unsupported fallback, selections, stored marks, node/cell selection, IME,
origins, loop prevention, browser/worker/server layout, and DOM/PDF/hit-test
display-list consumption.

#### Scenario: Same fixture runs in three runtimes
- **WHEN** browser, worker, and server use identical model, ports, fonts, and configuration
- **THEN** page geometry, display anchors, navigation targets, and declared output equivalence MUST match

### Requirement: API, RPC, and extension conformance is unified
Tests MUST prove equivalent parse/apply/query, agent/MCP schemas,
`DocxEditor.*` proxies, browser commands, server RPC, generated clients,
extension combinations, errors, locks, revision conflicts, and selective
DOCX/PDF export.

#### Scenario: One semantic workflow uses every surface
- **WHEN** the same create, search, edit, annotate, and export workflow is expressed through each supported surface
- **THEN** authored results, revisions, errors, and output equivalence MUST match

### Requirement: Benchmark corpus and runner are frozen
Benchmarks MUST use immutable source DOCX bytes, hashes, reference page-count
metadata, explicit feature matrices, and separate counts for tracked revisions
and engine edit history. The runner MUST specify process isolation, CPU affinity
policy, at least five warmups and thirty process-isolated measured runs per
case, a predeclared percentile and 95% bootstrap confidence interval,
dispersion/noise threshold, GC policy,
cold/warm resource state, and peak/retained-memory sampling points.
Post-hoc outlier removal MUST be forbidden. A run invalidated by a predeclared
environment criterion MUST invalidate and rerun the full case, not delete one
sample. Fixture bytes, hashes, and independent reference metadata MUST be frozen
before baseline collection.

#### Scenario: Threshold baseline is produced
- **WHEN** a baseline is proposed for ratification
- **THEN** raw per-run data, runner configuration, corpus hashes, comparator version, and selected percentile MUST be retained and reproducible

### Requirement: First useful layout and memory are defined
First useful layout MUST mean a declared initial viewport/page range with
resolved text, selectable anchors, and no pending required resources.
Peak memory MUST be process-isolated maximum resident plus tracked external
allocations; retained memory MUST be measured after a declared quiescence and GC
protocol. Measurements MUST state unsupported runtime limitations.

#### Scenario: Runtime cannot force GC
- **WHEN** retained memory is measured where GC cannot be forced
- **THEN** the run MUST use the declared quiescence protocol and MUST NOT compare directly with forced-GC baselines

### Requirement: Artifact comparators are explicit
Authored models MUST compare canonical normalized records excluding declared
ephemera; shaped runs, page breaks, fixed-point geometry, anchors, semantic tree,
and hit results MUST compare exactly. Replicas MUST compare authored/anchor
fingerprints and stable update/constituent ID application, not local revision
sequences or state-vector delete-set coverage. PDF MUST
be inspected through canonical semantic objects for pages, text/`ActualText`,
tags, links, geometry, fonts, and images; byte hashes MAY be used only after
metadata, object order, compression, and subset naming are canonicalized.

An independent reviewed reference-render corpus MUST be frozen before output
implementation with source bytes and expected pagination, fixed-point geometry,
raster checkpoints/tolerances, extracted logical text, semantic reading order,
and internal/external link destinations. Engine output MUST be measured against
those references, not only against another engine backend. Tagged PDF MUST
validate against PDF/UA-1 with a pinned validator/version and SHALL retain
validator reports; selecting another profile requires a reviewed design change.

#### Scenario: PDF bytes differ semantically not
- **WHEN** two PDFs differ only in permitted container metadata or object numbering
- **THEN** canonical PDF inspection MUST report semantic equivalence while preserving the byte difference as diagnostic data

### Requirement: Bounded frontier counters prohibit hidden scans
Incremental benchmarks MUST count visited semantic identities, dependency
vertices, projection ranges, cache entries, measured blocks, pagination pages,
display items, serialization ranges, DOM nodes, allocations, queue items, and
worker messages. Work outside changed identities, dependency closure, and pages
through convergence MUST be zero unless a named global dependency justifies it.

#### Scenario: End-of-document edit has bounded closure
- **WHEN** a frozen fixture edit declares closure C and convergence frontier P
- **THEN** every counter MUST remain within the ratified function of C and P and any total-document scan MUST fail the gate

### Requirement: Budget and cancellation lifecycle is hierarchical
Each operation MUST own a root budget with child reservations for parser,
extension, worker, layout, transport, and output work. Reservations MUST precede
allocation, use overflow-safe counters, propagate abort, checkpoint at declared
bounded intervals, bound queues/spill, and release memory/files/workers on every
exit. Non-cooperative untrusted hooks MUST run in terminable worker isolation.
Cancellation-latency thresholds MUST be ratified from frozen baselines.
Canonical publication is the cancellation point of no return. Cancellation
before publication MUST roll back canonical/backend state, journal, history,
revision, and notification. Cancellation after publication MUST return the
committed ID/revision and cancel only derived work. Every child reservation and
worker MUST finish/release before its root budget is released.

#### Scenario: Cancellation occurs during PDF export
- **WHEN** the root abort signal fires during a worker-backed output stage
- **THEN** child work MUST stop within its ratified checkpoint latency, queues and spill files MUST be removed, reservations MUST return to zero, and canonical state MUST remain unchanged
