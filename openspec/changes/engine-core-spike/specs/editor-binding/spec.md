## ADDED Requirements

### Requirement: The binding maps projection changes to semantic operations
The spike `EditorBinding` SHALL apply the complete transaction to a shadow
`EditorState`, map evolving multi-step positions to one `DocOp[]` batch, commit
the store, and reconcile the actual view only from normalized canonical state.
Rejection MUST discard the shadow. Unsupported transactions MAY derive
identity-preserving `ReplaceBlockContent` only for proven owned content;
semantic replacement MUST mint identity.

#### Scenario: Supported local typing becomes a semantic operation
- **WHEN** a user types into the browser projection
- **THEN** the binding emits an insert-text `DocOp` and no raw projection commit bypasses the store

### Requirement: Reverse reconciliation preserves selection
The binding SHALL reconcile a `ModelChange` into minimal projection changes or
an affected-block replacement while resolving selection through versioned
opaque relative-position envelopes. Paragraph-local UTF-16 positions are API
input only and MUST be encoded at commit, never persisted as annotation or mark
endpoint currency.

#### Scenario: Remote insertion before the caret
- **WHEN** a remote insertion is committed before the local caret
- **THEN** reconciliation moves the projection position as needed while preserving the same logical caret anchor

#### Scenario: Remote deletion contains the caret
- **WHEN** a remote deletion consumes the text containing the local caret
- **THEN** reconciliation resolves the caret to the deterministic deletion boundary without throwing

### Requirement: Reconciliation is safe during composition
The binding SHALL record composition start revision, anchored range, initial
text, local composing text, and ordered inbound changes. It MUST defer
intersecting reconciliation; commit maps final text once as one history group
before queued revisions, while cancel discards local text before queued
reconciliation. The fixture MUST declare exact expected strings.

#### Scenario: Remote change arrives during composition
- **WHEN** a remote `ModelChange` arrives while IME composition is active
- **THEN** the binding preserves the composition, defers projection reconciliation, and applies the latest normalized state after composition ends

### Requirement: Undo is local to the actor via Y.UndoManager
The spike SHALL use public `Y.UndoManager` per actor/session scoped to
`bodySequence` plus only the bake-off winner's tracked types frozen by the v2
oracle, with a stable origin token, explicit `stopCapturing` semantic group
boundaries, and a bounded reconstruction journal for durable snapshot/reopen.
Allocator, audit, awareness, capsules, repair metadata, and untracked
formatting-evidence metadata MUST stay outside manager scope. The local backend MUST match undo,
grouping, manager-stack redo semantics, remote interleaving, identity
restoration, and reopen behavior without mirroring Yjs shared-type topology.
Untracked remote and repair transactions MUST preserve redo. A new eligible
tracked transaction MUST clear redo only for the same actor+session manager;
another actor or session MUST NOT clear it. Undo/redo controls MUST reflect the
public manager's stack availability and pop order after explicit capture
boundaries. Implementation MUST pass G-v2-1..G-v2-10 before task 2.8
acceptance; v1 task 2.2 backend acceptance does not prove v2.

#### Scenario: One actor undoes after concurrent edits
- **WHEN** two actors make concurrent edits and one actor invokes undo
- **THEN** only that actor's eligible change is reversed and the other actor's change remains

#### Scenario: Same-tail split remote edit survives undo and redo
- **WHEN** actor A splits a paragraph tail, actor B edits the tail, actor A undoes the split, the document is reopened, and actor A redoes
- **THEN** actor B's remote edit survives, split/join IDs match the frozen G-v2-1 oracle, and no nested shared types were created by the split

#### Scenario: Observed mark disable does not remove unseen enable
- **WHEN** actor A disables observed bold while actor B's concurrent bold enable is not yet observed
- **THEN** the formatting winner preserves actor B's unseen enable after merge and undo per G-v2-5

#### Scenario: Remote work preserves redo
- **WHEN** one actor undoes an eligible group and remote or repair transactions commit
- **THEN** that actor+session manager retains the same redo item and redo reapplies it without reverting untracked work

#### Scenario: Same-session tracked work clears redo
- **WHEN** one actor undoes and then commits a new eligible tracked group in the same session
- **THEN** only that actor+session redo stack clears; other actor/session managers are unchanged

### Requirement: Binding reconciliation cannot feed back
Binding-generated transactions SHALL carry the binding-reconciliation origin and MUST be ignored by the forward mapper. Remote changes and awareness updates MUST be distinguishable from binding reconciliation.

#### Scenario: One remote change reconciles once
- **WHEN** a remote `ModelChange` is reconciled into the browser projection
- **THEN** the generated transaction is tagged as binding reconciliation, emits no new semantic operation, and causes no feedback loop

### Requirement: Schema-backed commands are runtime-equivalent
The spike SHALL route one schema-backed `DocxEditor.*` command through the same semantic command handler in browser binding and PM-free server execution.

#### Scenario: Browser and server execute the same command
- **WHEN** identical initial state and command payload are executed once through the browser binding and once through a PM-free server
- **THEN** both paths produce equivalent authored canonical state, revision effects, and semantic result data

### Requirement: Selection matrix is executable
The spike MUST cover forward/backward text ranges, stored marks, node selection,
partial/complete cell-selection placeholders, and whole-document deletion using
the same anchor/affinity resolver, even though the toy model renders non-text
selection cases as synthetic selection records.

#### Scenario: Selected synthetic node is deleted
- **WHEN** remote deletion removes the selected synthetic node
- **THEN** selection MUST clear or collapse to the declared boundary and MUST NOT attach to another node
