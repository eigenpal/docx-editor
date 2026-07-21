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

### R5 — Concrete Yjs schema is part of the spike, with invariants

The spike root map is versioned and contains `meta`, `storyOrder`, `stories`,
`blocks`, `texts`, `marks`, `capsules`, and `allocator`. `storyOrder` and each
story's block order are `Y.Array<CreationId>`; records are keyed by
collision-free creation identity and retain proposed semantic ID plus
actor/commit provenance; paragraph text
is `Y.Text`; marks are creation-keyed `Y.Map` records retaining semantic mark
IDs with half-open relative start/end endpoints and affinity; the capsule is a `Y.Map` record containing exact
bytes and ownership metadata. Parent IDs are mandatory. Transaction origins are
typed mutation origins. GC is disabled for the harness so tombstones remain
inspectable. Every concurrent semantic-ID candidate remains observable and
collisions are renamed by lexicographic
`ActorId/CommitId` ordering and every reference is repaired. Convergence ≠
validity: after any merge a **deterministic
repair/normalization pass (R7)** restores DOCX invariants (e.g. row deleted while
a cell in it is edited → cell edit reparented or dropped by rule).

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
type DocAnchor = { storyId: StoryId; blockId: BlockId
                   relativeTextPosition?: BackendRelativePosition; affinity: 'before' | 'after' }
```

The spike pins annotation-anchor behavior for concurrent edits. Insertion at an
anchor follows its affinity; deletion of the full anchored range collapses both
ends to the deletion boundary and marks the annotation detached; a split keeps
an endpoint with the text it addressed, using the new tail ID when that text
moves to the tail; a join remaps endpoints from the removed block to the
surviving block at the equivalent text boundary. Deterministic repair applies
delete before split/join when their targets no longer survive. An anchor never
silently attaches to unrelated text.

`store.transact` commits multi-op, multi-part changes (insert image = body node +
relationship + media part + content type) as **one** revision; subscribers never
see intermediate invalid state.

The public spike exposes an opaque `AnchorHandle`; the structure above is
private. Trusted spike snapshot/awareness envelopes bind encoded relative bytes
to document ID, backend/schema version, checkpoint, and affinity.

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
updates. Undo fixtures pin actor/session/group identity, redo invalidation,
remote interleaving, identity restoration, normalization ownership, and
snapshot/reopen behavior.

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

paste + lists → tables → multiple stories + package parts → full OOXML pipeline.
If the spike cannot hold any of the fifteen gates cleanly, reconsider the
architecture here, not after the DOCX model exists.

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

- The spike pins only its paragraph/text/mark schema; production table shapes
  remain a production schema task.
- Undo mechanism: Yjs `UndoManager` vs store-level inverse `DocOp`s (spike
  decides; behavior must match solo/collab).
- Persistence/schema-evolution versioning (required before "durable addressable
  documents" is claimed; not needed for the spike).
- Snapshot cadence, update-log compaction, GC.
