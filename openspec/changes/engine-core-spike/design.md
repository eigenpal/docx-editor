## Context

An architecture review of commit `checkpoint-e743b783` accepted the model-canonical
direction but found the three components carrying the real complexity —
`DocumentModel`, `DocumentStore` + replication backend, and `EditorBinding` —
underspecified, and flagged statements that presented unsolved problems as
architectural consequences. This design resolves the foundational contracts and
defines a falsification spike. It supersedes the conflicting framing in
`modular-core-api` D5 (DocumentSource), `remote-document-sync` D1 (corrected),
and `ooxml-document-pipeline` D3/D5 (authored-vs-resolved).

Process note: the review lists many "decide first" items and a risk-first spike.
Those are resolved by tiering — a small set of decisions *frames* the spike
(below), and the spike *empirically settles* the rest. We do not front-load a
months-long spec pass.

## Resolved decisions (pre-spike)

### R1 — The Office JavaScript-style shape is a facade; the canonical store is a lossless package model

The `DocxEditor.*` object model is application ergonomics, not a storage schema. It
cannot express run boundaries, paragraph-mark props, field instruction/result
spans, bookmarks/permissions, content controls, tracked structural changes,
relationship IDs/target modes, theme-ref-vs-resolved color, raw/omitted values,
unsupported extension elements, or significant XML order. Storing only resolved
API values loses authored intent on export (direct formatting written onto every
run).

```
Canonical package model (authored, lossless)
  ├── semantic editable stories        (body, headers, footers, notes, comments, textboxes)
  ├── authored OOXML properties         (as-authored, incl. explicit-omission)
  ├── stable part + relationship identities
  ├── preservation capsules             (opaque, for unsupported/unknown content + order)
  └── derived caches (fingerprinted; revision provenance)

DocxEditor.* object model  →  lazy facade/views over the canonical model
```

### R2 — Authored is canonical; resolved cache records provenance

```ts
interface DocumentModel { authored: AuthoredPackageModel; revision: ModelRevision }
interface ResolvedModelCache { revision: ModelRevision; stylesByNodeId: Map<NodeId, ResolvedStyle> }
```

Measurement reads the resolved cache; serialization reads `authored`. Entries
record revision as provenance and dependency/input fingerprints; a style
mutation invalidates only dependent entries, while cross-revision reuse requires
matching fingerprints and immutable operation environment. This is foundational.

### R3 — Four contracts, not "one currency"

`DocOp` is the single semantic **mutation vocabulary**. It is not the sync
currency. Distinct, named:

- **`DocOp`** — semantic op (insert/delete/split/join/setMark/setProp/…), the
  input to `store.apply`, invertible, carries story/part ownership.
- **`ModelChange`** — committed notification (dirty nodes + revision) consumed by
  `EditorBinding` reconciliation and layout invalidation.
- **replication update** — opaque backend bytes on the wire.
- **snapshot** — full encoded state for initial sync / persistence.

Decisions pinned: a redacted audit index is distinct from an access-controlled,
encrypted replay journal containing complete versioned `DocOp` payloads;
replication updates compact into snapshots; a remote update is translated to
`ModelChange` by the replication coordinator after staged merge/normalization
(it need not expose the originating `DocOp`s);
`encode()` is a full snapshot, distinct from incremental updates.

### R4 — Three boundaries; PM-free replication

```ts
interface DocumentStore {          // semantic, PM-free, canonical
  readonly model: DocumentModel
  apply(op: DocOp, origin?: Origin): ApplyResult
  transact(origin: Origin, fn: () => void): ApplyResult      // atomic, one revision (R8)
  subscribeModel(cb: (c: ModelChange, o: Origin) => void): Unsubscribe
  createAnchor(a: DocAnchor): AnchorHandle
  resolveAnchor(h: AnchorHandle): DocAnchor | null
}
interface ReplicatedStoreBackend { // opaque bytes; the CRDT lives here; PM-free
  encodeSnapshot(): Uint8Array
  applyRemoteUpdate(u: Uint8Array, o?: Origin): void
  subscribeUpdates(cb: (u: Uint8Array, o: Origin) => void): Unsubscribe
  awareness?: AwarenessChannel
}
interface EditorBinding {           // the ONLY PM-aware layer, in the binding package
  bind(store: DocumentStore, view: EditorView): Unsubscribe
}
```

No PM type exists in the store or backend. Yjs holds the **document model**, not
a PM fragment; the PM↔model map is solely the `EditorBinding` (R6).

### R5 — Spike-only Yjs schema v2; v1 rejected

The v1 nested model-shaped schema (`blocks`, `texts`, per-paragraph `Y.Text`,
creation-keyed `marks` maps with destructive normalization) is **rejected** — see
`yjs-schema-v2-design.md` and task 2.2 historical evidence. New work follows
**schema v2 for the falsification harness only**:

- One long-lived `bodySequence: Y.Text` per story, created at bootstrap; split/join
  insert/remove immutable paragraph-boundary embeds only — never create/delete a
  `Y.Text`. The sequence begins with at least one opening boundary; each boundary
  starts one paragraph ending at the next boundary or sequence end; there is no
  terminal sentinel. Split inserts one opening boundary and join removes one
  non-first opening boundary.
- Boundary items are immutable length-1 plain JSON values inserted with
  `Y.Text.insertEmbed`, never nested `Y.AbstractType` values. Paragraph-local
  UTF-16 is API input resolved at commit, not persisted endpoint currency.
- Plain-JSON relative endpoint envelopes store bounded canonical
  `relativePositionBase64Url: string`, never `Uint8Array`; decoding allocates
  bytes only after character, length, and canonical re-encode validation.
- The reviewed task 2.4 KISS experiment selected immutable creation-only
  `mark-contributions`; that executed focused result is authoritative for this
  spike. The abandoned `experiments/yjs-formatting-bakeoff/oracle/**` corpus is
  unexecuted historical work and is neither consumed nor authoritative.
- The selected representation MUST preserve same-kind actor undo, observed-disable/unseen-enable,
  bold/italic independence, endpoint behavior through text/split/join, semantic
  mark identity/provenance, authored omission/raw intent, undo/reopen/redo,
  non-destructive normalization, convergence, and closed resource bounds.
- Canonical paragraphs and marks are a deterministic projection from sequence +
  the representation-neutral `FormattingEvidence` winner contract, clipping at
  boundary items. Boundary collisions, normalized mark IDs/provenance, and
  monotonic repair keying follow the lean winner contract; repair MUST NOT
  destructively rewrite actor-authored state.
- Formatting evidence partitions boundary-clipped text at all add/remove/
  paragraph endpoints, applies only valid targeted removes per interval/kind,
  omits intervals without active adds, and merges only identical kind,
  contributor, clipping-remove, and authored-intent sets. Its IDs/provenance
  follow the closed derivation and uint32be/UTF-8 hash framing in the v2 design.
- GC disabled. Typed mutation origins. Closed trust-boundary limits (see v2
  design doc).

Convergence ≠ validity: after any merge a **deterministic repair/normalization
pass (R7)** still restores spike invariants, but without mutating embed payloads
or winner-owned formatting history. The sole production authority is
`openspec/changes/document-engine/design.md` plus
`openspec/changes/document-engine/specs/**`; this spike selects only a one-body
proof representation and makes no production table or mark schema commitment.
The migration ledger is non-authoritative inventory by its own header, and no
ledger contradiction can expand this spike's authority.

The approved supporting stack is Yjs; public `Y.UndoManager`;
`y-protocols/awareness` for ephemeral presence; custom
`DocOp`/projection/repair/capsules/`ModelChange`; custom `EditorBinding`;
transport-neutral networking (`y-websocket` spike/demo only); and custom
update/snapshot/compaction persistence.

### R6 — EditorBinding is a first-class engine

```ts
interface OperationMapper {
  canMap(step: Step, ctx: MappingContext): boolean
  toOperations(step: Step, ctx: MappingContext): DocOp[]      // forward: PM → ops
  reconcile(change: ModelChange, state: EditorState): Transaction | null  // reverse
}
```

- **Extensible**: extensions that add content types register a mapper.
- **Unsupported-transaction fallback policy (explicit)**: if no mapper claims a
  step, the binding applies it only to a shadow `EditorState` and derives
  identity-preserving `ReplaceBlockContent` when capsule ownership is proven.
  Semantic `ReplaceNode` mints identity. No fallback bypasses `store.apply`.
- **Reverse reconciliation** must: map model ranges to PM positions via
  `DocAnchor`; prefer minimal steps, fall back to block replace; preserve
  selection, stored marks, node/cell selections; defer during IME composition;
  **tag generated transactions** with a binding origin so they do not round-trip
  back into `DocOp`s (loop prevention); update decorations/relative positions.

### R7 — One authoritative normalization path

```
DocOp → validate → canonical model transaction → deterministic repair/normalize
      → one committed ModelChange → PM reconciles to the normalized result
```

Under v2, normalize means **project** paragraphs/marks from sequence + the
bake-off winner's `FormattingEvidence` and append monotonic repair evidence when needed; it MUST NOT
destructively rewrite boundary embeds or winner-owned formatting history (see
`yjs-schema-v2-design.md`).

PM plugins / `appendTransaction` MUST NOT mutate canonical semantics after
commit; any normalization they emit is converted to `DocOp`s before being
treated as committed. Repair is deterministic so replicas converge to the same
normalized state.

### R8 — Stable identity, compound anchors, atomic multi-story transactions

Stable IDs for stories, blocks, paragraphs, tables/rows/cells, runs (where
needed), comments, revisions, bookmarks, relationships, parts. Identity rules:
split keeps the ID on the **first** fragment and mints a new one for the tail;
join keeps the **surviving (first)** ID; move keeps ID; block replace mints a new
ID; delete+undo restores the original ID; concurrent split/delete resolves by the
repair pass (R7).

```ts
type DocAnchor = {
  storyId: StoryId
  start: OpaqueRelativeEndpointEnvelope
  end: OpaqueRelativeEndpointEnvelope
}
```

The spike pins annotation endpoints as opaque, versioned public-API-encoded
`Y.RelativePosition` envelopes bound to document ID, schema/backend versions,
checkpoint, story-sequence creation ID, assoc, and affinity. Paragraph-local
UTF-16 is accepted only as API input and encoded during commit preflight.
Insertion follows assoc/affinity; full deletion collapses/detaches when deletion
mapping proves the boundary. Wrong-document/version/sequence envelopes reject;
unverifiable stale input rejects; an existing unresolvable endpoint detaches to
the proved deletion boundary or resolves detached/null. It never attaches to
unrelated text.

`store.transact` commits multi-op, multi-part changes (insert image = body node +
relationship + media part + content type) as **one** revision; subscribers never
see intermediate invalid state.

The public spike exposes an opaque `AnchorHandle`; the structure above is
private. Trusted spike snapshot/awareness envelopes bind bounded canonical
base64url relative-position strings to document ID, backend/schema version,
checkpoint, story-sequence creation ID, assoc, and affinity.

### R9 — Incremental layout is dependency-aware, not "only the changed block"

Guarantee: a `ModelChange` avoids remeasuring unaffected blocks *where
dependencies permit*; pagination **resumes from the earliest affected flow
position and runs until page state re-converges**. Dependency closure: changed
block → style/numbering deps → measure dirty set → pagination restart point →
downstream until convergence → cross-reference (page #, PAGEREF/TOC) second pass.

### R10 — Display list carries opaque anchors; server contexts are revision-aware

Painted items carry opaque anchor handles (not PM offsets); the
`EditorBinding` resolves anchors ↔ PM positions for hit-testing and selection.
Server edit contexts pin `baseRevision`; each `sync()` reconciles to latest;
writes on stale ranges are anchor-adjusted or rejected by precondition; one
`sync()` is atomic (R8).

### R11 — Security mechanics specified (policy still integration-owned)

Seams that MUST exist even though policy is the developer's: auth hook before
joining a room; authz hook before `applyRemoteUpdate`; max update/snapshot size;
rate-limit integration point; per-document tenancy key; malformed-update
rejection; server-side export limits; audit metadata on server-originated ops;
explicit refusal to load remote external resources.

## The falsification spike

The spike's authority is deliberately narrow: it may accept or falsify the
canonical authored store, replication coordinator, editor binding, anchor,
origin/awareness separation, undo mechanism, and bounded-work architecture.
It does not accept production shaping, pagination, display-list, PDF,
accessibility, or performance claims; those retain production conformance gates.

Scope (deliberately tiny): one body story; paragraphs; text; bold/italic;
stable paragraph IDs; insert/delete/split/join `DocOp`s; **Yjs and local**
backends behind `ReplicatedStoreBackend`; minimal layout from canonical
paragraphs; one unsupported OOXML preservation capsule; a schema-backed
`DocxEditor.*` command exposed through browser binding and PM-free server
execution; one citation/annotation anchor; origin and awareness metadata; a
synthetic large-document fixture; and a golden parity harness. These additions
are proof fixtures only, not production feature implementations.

Before gate execution the harness freezes:

- one exact unsupported capsule byte sequence, byte boundaries, owning
  paragraph child slot, namespace bindings, and previous/next sibling bytes;
- one toy `ShapingEnvironment` containing a versioned glyph-advance table,
  fixed-point scale, and round-half-away-from-zero rule;
- a reviewed pre-implementation manifest with exact source text/style records,
  zero-based indices, and a 128-paragraph fixture with dependency `style-A`,
  four paragraphs per toy page, and the exact style mutation affecting
  paragraphs 64–67;
- cold/warm cache state and expected pagination fingerprint bytes/hash of
  ordered paragraph IDs, fixed-point used height, and next-flow ID, independently
  produced before implementation, with at most four passes before failure;
- included setup/projection/measurement/pagination phases and exact counter
  increment definitions;
- fixture ceilings: at most 4 measured paragraphs, 4 projected paragraphs,
  restart at paragraph 64, at most 2 paginated pages after restart, 0
  full-document scans/rebuilds, and at most 128 dependency-edge visits.

These are fixture-owned proof ceilings, not production budgets.

Task 2.5 is intentionally smaller than the older preimplementation-oracle
approach. Its four compatibility artifacts freeze closed schema/constants,
behavior ownership, comparator input schemas, and concise G-v2-1..G-v2-10
action/assertion descriptors only. They do not freeze exhaustive fixtures,
implementation output, or canonical-state fingerprints. Artifact self-hashes
detect accidental drift only. Tasks 2.6–2.8 and 3.x add direct executable
expected-state assertions test-first for the behavior they own.

### R12 — Coordinator, transaction, and projection protocols are executable

The spike implements the production-shaped state transitions in miniature:
local semantic transactions stage canonical and Yjs changes, normalize, commit
both or neither, assign commit/update IDs and one local revision, notify once,
and suppress echo. Remote updates authenticate/deduplicate, stage merge,
normalize/repair inside the same Yjs transaction, publish once, and propagate
repair once. Delivery is at-least-once and deduplicates stable update/constituent
IDs; state vectors optimize synchronization and never prove delete-set coverage.

`store.transact` supplies a synchronous context, rejects nesting/async/reentry,
and rolls back on exceptions. Browser dispatch maps the complete transaction
against a shadow `EditorState`; the actual view is reconciled only after
canonical commit. `ModelChange` carries before/after ranges needed by the toy
binding.

The spike distinguishes `MutationOrigin`, `ProjectionOrigin`, and
`AwarenessOrigin`. Projection reconciliation never enters store history or
updates. Undo uses public `Y.UndoManager` per actor/session scoped to
`bodySequence` plus only the winner-tracked types frozen by task 2.5; it uses a
stable origin token, explicit
`stopCapturing` group boundaries, and a bounded reconstruction journal for
durable reopen; allocator, audit, awareness, capsules, and repair metadata stay
outside manager scope. Untracked remote/repair work preserves redo; only a new
eligible tracked transaction clears redo for the same actor+session manager.
Other sessions do not. Undo/redo controls follow manager stacks exactly. Local
backend matches behavior, not mechanism. Closed preflight limits and the ten
named v2 proof gates (G-v2-1..G-v2-10 in
`yjs-schema-v2-design.md`) are mandatory.
G-v2-6 is a task 2.8 winner-formatting-endpoint gate only. Selection and
annotation endpoint behavior remains separately owned by tasks 3.2 and 4.3.

### Acceptance gates (all fifteen must hold)

1. Local typing produces `DocOp`s (never a raw PM commit past the binding).
2. The model is updated before PM is treated as committed (R7 order).
3. Two Yjs clients converge on identical `authored` model.
4. A headless server (no PM, no DOM) inserts text via `DocOp` and both clients reconcile.
5. Remote insertion **before the caret** preserves the local selection.
6. Remote deletion **containing the caret** resolves the selection by rule, no crash.
7. **IME composition** stays correct (reconciliation deferred during compose).
8. Undo affects only the local user's changes (per-user undo).
9. Layout reads `store.model`, never the `EditorView`; same model ⇒ same pagination on client and server.
10. Export→reopen preserves semantic content **and authored properties** (no resolved-value normalization).
11. Selective export preserves an untouched unsupported OOXML capsule byte-for-byte
    while retaining authored omission and raw lexical values in the edited part.
12. The same schema-backed `DocxEditor.*` command produces equivalent canonical
    state through the browser binding and through PM-free server execution.
13. A citation/annotation internal anchor obeys the R8 affinity, collapse,
    detach, split-remap, and join-remap rules under concurrent insertion,
    deletion, split, and join.
14. Origin and awareness metadata distinguish human, agent, remote, undo, and
    binding-reconciliation activity; binding reconciliation emits no feedback
    loop and awareness does not enter authored state.
15. A bounded edit in a synthetic large document performs no whole-document
    projection or rebuild, changes one dependency, converges to the canonical
    toy fingerprint within four passes, and remains within every frozen fixture
    counter ceiling.

### Parity harness (the proof, not unit tests)

```
model₀ + PM transaction → DocOps → model₁       ⟺   model₀ + expected DocOps → model₁
model₀ + EditorState + remote DocOps → ModelChange → reconciled EditorState
                                                  ⟺   equivalent PM doc + preserved selection
schema command + browser binding → model₁       ⟺   schema command + PM-free server → model₁
```

Property/fuzz variant: random transactions keep PM and model consistent; random
concurrent op sets converge. This runs before any feature is added.

### Order after green

If the spike cannot hold any of the fifteen gates cleanly, reconsider the
replication/history experiment here. Passing it does not change any
`document-engine` contract or conformance requirement.

## Risks / Trade-offs

- **The `EditorBinding` is the highest-risk code in the system** → property-test
  gate (above) before anything builds on it; it is a first-class capability, not
  an adapter.
- **Authored+cache doubles model bookkeeping** → cache is derived,
  fingerprinted with revision provenance, never serialized, and rebuilt on
  demand.
- **Backend-neutrality can be assumed falsely** → build local + Yjs together; a
  conformance suite gates any later Automerge backend (`swappable` = tested, not
  assumed).
- **Repair determinism is subtle** → repair rules are pure functions of the
  converged state; property-tested for replica agreement.

## Open Questions (deferred to the spike or later, not blocking)

- Undo mechanism: **resolved** — public `Y.UndoManager` + bounded reconstruction
  journal; v1 nested schema rejected (`yjs-schema-v2-design.md`).
- Persistence/schema-evolution versioning (required before "durable addressable
  documents" is claimed; not needed for the spike).
- Snapshot cadence, update-log compaction, GC.
