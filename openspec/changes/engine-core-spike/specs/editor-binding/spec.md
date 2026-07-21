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
The binding SHALL reconcile a `ModelChange` into minimal projection changes or an affected-block replacement while resolving selection through internal anchors.

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

### Requirement: Undo is local to the actor
The spike SHALL record actor/session/group IDs, eligible mutation origins,
inverse operations, identity tombstones, and repair ownership. It MUST prove
equivalent solo/collaborative grouping, actor-local undo, redo invalidation,
remote interleaving, ID restoration, failed/normalized-operation behavior, and
durable snapshot/reopen history.

#### Scenario: One actor undoes after concurrent edits
- **WHEN** two actors make concurrent edits and one actor invokes undo
- **THEN** only that actor's eligible change is reversed and the other actor's change remains

#### Scenario: Redo survives remote interleaving and snapshot
- **WHEN** an actor undoes a split, a remote insert arrives, the durable snapshot is reopened, and the actor redoes
- **THEN** redo MUST restore the split IDs and actor-owned content without reverting the remote insert

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
