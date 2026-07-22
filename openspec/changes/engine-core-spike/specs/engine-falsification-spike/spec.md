## ADDED Requirements

### Requirement: The spike remains deliberately narrow
The implementation SHALL be a disposable architecture-falsification harness limited to one body story, paragraphs, text, bold and italic marks, stable paragraph identities, insert/delete/split/join operations, local and Yjs backends, minimal canonical-model layout, one preservation capsule, one schema-backed command, one annotation anchor, origin and awareness metadata, and one synthetic large-document fixture. It MUST NOT implement the production document engine.

#### Scenario: Spike scope is reviewed
- **WHEN** the spike implementation and dependencies are inspected
- **THEN** every component exists to exercise a named acceptance gate and no production feature breadth has been added

### Requirement: The approved spike stack remains bounded
The spike SHALL use Yjs with one long-lived `Y.Text` per story, plain immutable
paragraph-boundary embeds, stable creation-keyed structural records, bound
`Y.RelativePosition` envelopes, public `Y.UndoManager`, and
`y-protocols/awareness` for ephemeral presence. `DocOp`, document projection,
repair, capsules, `ModelChange`, ProseMirror `EditorBinding`, and
update/snapshot/compaction persistence SHALL remain custom engine contracts.
Networking SHALL be transport-neutral; `y-websocket` MAY wire the spike/demo but
MUST NOT become an engine/store/protocol dependency.

#### Scenario: Demo transport is replaced
- **WHEN** the spike demo substitutes another transport for `y-websocket`
- **THEN** semantic operations, replication bytes, awareness, persistence, projection, and binding contracts remain unchanged

### Requirement: Spike authority is narrow
Passing the spike SHALL accept or falsify only the canonical authored store,
replication coordinator, editor binding, anchors, origin/awareness, undo
mechanism, and fixture-bounded-work architecture. It MUST NOT accept production
shaping, pagination, display-list, accessibility, PDF, performance, multiple
stories, cells, tables, or production schema behavior. Yjs schema v2 is
spike-only. The sole production authority is
`openspec/changes/document-engine/design.md` plus
`openspec/changes/document-engine/specs/**`. This spike selects only a one-body
proof representation and MUST NOT commit to a production table or mark schema.
The migration ledger is non-authoritative inventory by its own header; no
ledger entry or contradiction can expand spike authority.

#### Scenario: All spike gates pass
- **WHEN** production layout work is proposed
- **THEN** the production layout/output and performance conformance gates MUST still be required

### Requirement: Toy layout fixture and ceilings are frozen
The harness MUST freeze the exact capsule bytes/ownership/namespace/siblings;
exact source paragraph text/style records and zero-based indexing; versioned toy
glyph advances, fixed-point scale, and rounding; a 128-paragraph fixture with
four paragraphs per page; the exact `style-A` source mutation affecting
paragraphs 64–67; cold/warm cache state; and expected canonical fingerprint
bytes plus hash of page paragraph IDs, used height, and next-flow ID. The
reviewed manifest MUST define included setup/projection/measurement/pagination
phases and each counter increment, fail after four pagination passes, and carry
an independently produced oracle/hash frozen before implementation. Ceilings are
four measured and projected paragraphs, restart at zero-based paragraph 64, two
paginated pages, zero whole-document scans/rebuilds, and 128 dependency-edge
visits.

#### Scenario: Dependency-changing edit is measured
- **WHEN** the frozen style edit is applied
- **THEN** every counter MUST stay within its ceiling and pagination MUST reach the exact fingerprint within four passes

### Requirement: Formatting A/B precedes v2 oracle freeze
The harness MUST first run an isolated, commit-sized falsification comparing
native `Y.Text` formatting attributes with immutable creation-only range
contributions. It MUST use identical fixtures and freeze pass/fail evidence for
overlapping same-kind actor undo, observed-disable/unseen-enable, bold/italic
independence, text/split/join endpoint behavior, semantic mark identity and
provenance, authored omission/raw intent, undo/reopen/redo, non-destructive
normalization, convergence, and resource bounds. Contributions are the current
recommendation, not an authoritative requirement before this experiment.

#### Scenario: Formatting winner is selected
- **WHEN** the A/B experiment completes
- **THEN** the exact winner rule and tie-breakers in `yjs-schema-v2-design.md` select one representation, or both failures block v2 oracle freeze

### Requirement: Reviewed oracle artifacts precede implementation
Versioned oracle artifacts MUST be reviewed and frozen before implementing the
code they judge. v2 work SHALL use `yjs-schema.v2.json`, `binding-oracle.v2.json`,
`history-oracle.v2.json`, and `comparator-contracts.v2.json` aligned to
`yjs-schema-v2-design.md`, including the selected v2 formatting representation;
plain JSON length-1 boundary embeds; versioned opaque relative endpoint
envelopes with bounded canonical base64url strings and rejection/detach rules;
the winner's `FormattingEvidence`, normalized-ID, collision, and
non-destructive repair semantics; all closed preflight ceilings; exact IME
inputs/expected strings; selection grapheme boundaries and affinities; public
manager-stack redo rules; grouped undo/redo/snapshot histories; fixtures
G-v2-1..G-v2-10; and comparator versions. v1 oracle files remain historical
evidence. The v2 oracle set MUST contain only the winner's root, fields,
mutation rules, `FormattingEvidence` derivation, and comparators; loser evidence
remains isolated under task 2.4 and MUST NOT leak into the schema. Implementation-produced output MUST NOT be promoted to its own oracle.

#### Scenario: Gate implementation starts
- **WHEN** v2 backend, normalization, binding, selection, IME, or undo code is proposed
- **THEN** its reviewed v2 oracle artifact MUST already exist with an independent approval record

#### Scenario: v2 proof gates are frozen before history code
- **WHEN** Y.UndoManager integration or actor-local history is implemented
- **THEN** fixtures for G-v2-1..G-v2-10 MUST already be frozen with expected canonical fingerprints

### Requirement: All fifteen acceptance gates are mandatory
The spike SHALL pass all fifteen acceptance gates before the architecture is accepted for production implementation.

#### Scenario: Gate 1 maps local typing
- **WHEN** local typing occurs in the browser projection
- **THEN** it produces `DocOp` values and no raw ProseMirror commit passes the binding

#### Scenario: Gate 2 commits the model first
- **WHEN** a mapped projection transaction is processed
- **THEN** the model is normalized and updated before the projection is treated as committed

#### Scenario: Gate 3 converges Yjs replicas
- **WHEN** two Yjs-backed replicas exchange concurrent supported edits
- **THEN** they converge on the same canonical authored and anchor fingerprints with every stable update/constituent ID applied; state vectors remain diagnostic only

#### Scenario: Gate 4 reconciles a headless server edit
- **WHEN** a PM-free and DOM-free server inserts text through a `DocOp`
- **THEN** both browser replicas reconcile to the committed server state

#### Scenario: Gate 5 preserves selection before a remote insertion
- **WHEN** a remote insertion is committed before the local caret
- **THEN** the caret preserves its logical anchored position

#### Scenario: Gate 6 resolves selection inside a remote deletion
- **WHEN** a remote deletion contains the local caret
- **THEN** the caret resolves by the explicit deletion-boundary rule without a crash

#### Scenario: Gate 7 preserves IME composition
- **WHEN** remote reconciliation is requested during IME composition
- **THEN** the frozen insert/delete conflict fixtures produce their exact expected strings, one local history group, and no duplicate composition text

#### Scenario: Gate 8 limits undo to local changes
- **WHEN** one actor invokes undo after concurrent edits including v2 sequence splits, joins, and winner-owned formatting
- **THEN** grouping, same-session-only redo invalidation, remote/repair redo preservation, identity restoration, G-v2-1..G-v2-10 expectations, closed limits, and snapshot/reopen history match the frozen v2 oracles

#### Scenario: Gate 9 lays out canonical state in every runtime
- **WHEN** browser and server layout receive equivalent canonical models and layout inputs
- **THEN** they produce the exact toy fingerprint with exact fixed-point shaping inputs without reading an `EditorView`

#### Scenario: Gate 10 preserves authored properties across reopen
- **WHEN** the spike exports and reopens an edited fixture
- **THEN** semantic content and authored properties survive without resolved-value normalization

#### Scenario: Gate 11 preserves selective OOXML state
- **WHEN** selective export follows a supported edit
- **THEN** only the frozen owned byte range and required container metadata differ while capsule bytes, namespace context, sibling position, and all unowned bytes remain identical

#### Scenario: Gate 12 proves browser and server command parity
- **WHEN** the same schema-backed `DocxEditor.*` command runs from identical state through browser binding and PM-free server execution
- **THEN** both paths produce equivalent canonical state and semantic results

#### Scenario: Gate 13 preserves an annotation anchor
- **WHEN** concurrent insertion, deletion, split, and join affect the anchored range
- **THEN** its versioned relative envelopes follow assoc/affinity, collapse/detach on unresolvable deletion, reject wrong bindings, and resolve across split/join without attaching to unrelated text

#### Scenario: Gate 14 separates origin and awareness without loops
- **WHEN** mutation, projection, and awareness activity is observed
- **THEN** the three typed origin domains remain distinct, projection emits no feedback operation, and awareness remains outside authored state

#### Scenario: Gate 15 bounds large-document edit work
- **WHEN** a bounded edit is applied to the synthetic large-document fixture
- **THEN** all frozen counter ceilings and the four-pass fingerprint bound MUST pass

### Requirement: The parity harness is reproducible
The spike SHALL provide deterministic fixtures and a golden parity harness for projection-to-model mapping, reverse reconciliation, browser/server command execution, local/Yjs conformance, export/reopen preservation, anchor behavior, and bounded layout work. A failed gate MUST identify the fixture, seed where randomized, origin, revisions, and divergent state or work trace.

#### Scenario: A randomized parity failure is diagnosable
- **WHEN** a seeded randomized operation sequence produces divergent projection, model, replica, or layout state
- **THEN** the harness reports the seed, operation sequence, origins, revisions, and minimal divergent outputs needed to reproduce the failure
