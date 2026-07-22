# Yjs schema v2 design (engine-core-spike)

Approved redesign constraints after the v1 falsification verdict. This document
supersedes the nested `Y.Map`/`Y.Text` per-paragraph schema frozen in
`spike/engine-core-spike-harness/oracles/yjs-schema.v1.json` for new spike work,
except that the authoritative formatting representation is
**`mark-contributions`**, selected by the reviewed task 2.4 KISS experiment and
frozen as a lean task 2.5 contract. v1 oracle artifacts and tasks 1.1–2.3 remain
historical evidence only; they do not prove v2 acceptance.

## Verdict (narrow)

**Rejected:** the v1 model-shaped nested schema with destructively normalized
creation-keyed `blocks`/`texts`/`marks` containers. Same-target nested remote
edits and overlapping marks fail because untracked replacement consumes tracked
undo items and undo of locally created nested types deletes later remote child
edits.

**Retained:** Yjs as the replication backend and the public `Y.UndoManager` API
for actor-local undo/redo, with a bounded reconstruction journal for durable
undo across snapshot/reopen. The local backend MUST match observable undo,
grouping, redo-invalidation, and durable-reopen behavior; it MUST NOT mirror
Yjs mechanism or shared-type topology.

## Approved stack boundary

- **Yjs** replication with one long-lived `Y.Text` per story and plain immutable
  paragraph-boundary embeds
- Stable creation-keyed structural records and bound
  `Y.RelativePosition` envelopes
- Public **`Y.UndoManager`** for actor/session history
- **`y-protocols/awareness`** for ephemeral presence only
- Custom `DocOp`, document projection, deterministic repair, preservation
  capsules, and `ModelChange`
- Custom ProseMirror `EditorBinding`
- Transport-neutral networking contract; **`y-websocket` is spike/demo wiring
  only** and MUST NOT become a store or protocol dependency
- Custom persistence for updates, snapshots, bounded reconstruction,
  compaction, and replay

**Task 2.4 winner (authoritative):** `mark-contributions` — immutable
creation-only add/remove records in root `markContributions`. Candidate A
(`formattingMetadata` + native `Y.Text` attributes) failed overlapping
same-kind actor undo and observed-disable/unseen-enable criteria. Loser-only
roots, fields, and comparators MUST NOT appear in v2 oracle artifacts.
The abandoned `experiments/yjs-formatting-bakeoff/oracle/**` corpus was never
executed and is non-authoritative; v2 work MUST NOT read or derive contracts
from it.

## Authority and scope

Schema v2 is a **spike-only replication experiment**. It is not authoritative
for `document-engine`. The sole production authority is
`openspec/changes/document-engine/design.md` plus
`openspec/changes/document-engine/specs/**`. This spike selects only a one-body
proof representation and makes no production table or mark schema commitment.
`openspec/changes/document-engine/migration-ledger.md` is inventory and
non-authoritative by its own purpose/authority header; no statement or
contradiction recorded there can expand this spike's authority. This document
does not migrate, select, restate, or amend any production schema.

## Root topology (v2)

Versioned root `Y.Map` keys for the one-body spike:

| Key | Type | Role |
| --- | --- | --- |
| `meta` | `Y.Map` | `schemaVersion`, `backendVersion`, `documentId`, `normalizationVersion`, monotonic repair evidence (see Repair) |
| `storyOrder` | `Y.Array<CreationId>` | Ordered story creation IDs (spike: one body story) |
| `stories` | `Y.Map<CreationId, StoryRecord>` | Bootstrap metadata; the one body story owns one long-lived `bodySequence: Y.Text` |
| formatting evidence root | `markContributions` | Immutable creation-only add/remove contribution records (task 2.4 winner) |
| `capsules` | `Y.Map<CreationId, CapsuleRecord>` | Unchanged spike capsule ownership/bytes |
| `allocator` | `Y.Map` | Monotonic ID allocation; **outside** `UndoManager` scope |
| `audit` | `Y.Map` | Redacted audit cursor/index; **outside** `UndoManager` scope |

GC is disabled for the harness so tombstones and winner formatting history remain
inspectable.

### One long-lived `Y.Text` per story

At bootstrap each story record creates exactly one `bodySequence: Y.Text` that
lives for the document lifetime. Split and join NEVER create or delete a
`Y.Text`.

The sequence alternates:

```
[ boundaryEmbed₀, text₀, boundaryEmbed₁, text₁, …, boundaryEmbedₙ, textₙ ]
```

- **Boundary embeds** are plain immutable JSON values inserted only with
  `Y.Text.insertEmbed`. They MUST NOT be `Y.XmlElement`, `Y.Map`, `Y.Array`,
  `Y.Text`, or any other `Y.AbstractType`, directly or recursively.
- **Text runs** are plain UTF-16 insertions into `bodySequence` between boundary
  embeds.

Every boundary embed has Yjs sequence length exactly **1**. Absolute sequence
indices count each UTF-16 code unit as one and each embed as one. Paragraph-local
API offsets count only UTF-16 text units after the opening boundary and before
the next boundary; they exclude all embed units. Mapping local offset `n` scans
from `openingBoundaryAbsoluteIndex + 1`, counts text units only, and rejects if
`n` exceeds the paragraph text length or crosses the next boundary. Numeric
paragraph-local offsets are API input only and are resolved to relative-position
envelopes in the commit preflight; they are never persisted endpoint currency.

### Boundary embed payload (immutable after insert)

Each embed is inserted as
`bodySequence.insertEmbed(index, deepFrozenPlainJson)` and carries
creation-time-only fields:

- `creationId`, `proposedBlockId`, `proposedParagraphId`, `proposedTextSpanId`
- `actorId`, `commitId`
- `styleId`, authored paragraph properties (spike toy shape)
- `storyId` (parent story creation id)

Split inserts one new boundary embed at the split offset within the paragraph
text span; join deletes exactly one boundary embed (the join target). Identity
rules (R8, below) apply to projected paragraph IDs, not to mutating embed
payloads.

Validation recursively rejects non-plain objects, accessors, prototypes other
than `Object.prototype`/`null`, and nested shared types. The maximum plain-JSON
validation nesting is 4 and the canonical encoded payload ceiling is 4 KiB.

## Versioned relative-position envelopes

Every persisted annotation endpoint, and every explicit range endpoint used by
the contribution formatting candidate, is an opaque, versioned
`Y.RelativePosition` envelope:

```ts
type RelativeEndpointEnvelopeV2 = {
  envelopeVersion: 'relative-endpoint/2'
  documentId: DocumentId
  schemaVersion: SchemaVersion
  backendVersion: BackendVersion
  checkpoint: CheckpointId
  storySequenceCreationId: CreationId
  relativePositionBase64Url: string
  assoc: -1 | 0
  affinity: 'before' | 'after'
}
```

The envelope is plain JSON and never stores `Uint8Array`. Encoding obtains bytes
only from the public Yjs relative-position API and stores unpadded base64url.
Before decoding, validation MUST check that the containing payload is within its
frozen byte ceiling, the string length is at most
`ceil(256 KiB × 4 / 3) = 349526` ASCII characters, characters match
`^[A-Za-z0-9_-]+$`, no padding/whitespace exists, and `length % 4 !== 1`.
Only then may the decoder allocate bytes. It MUST reject unless re-encoding the
decoded bytes produces the exact original canonical string and decoded length
is at most 256 KiB. Decoded bytes are ephemeral decoder input and never stored
in authored state, envelopes, snapshots, journals, or audit records.

`affinity: 'before'` requires `assoc: -1`;
`affinity: 'after'` requires `assoc: 0`; any mismatch is invalid. Envelopes bind
to the one body sequence creation ID, not to a projected paragraph ID. API
paragraph-local UTF-16 input is resolved against the staged pre-mutation
sequence and encoded into this envelope before any write.

Preflight rejects the entire local transaction or staged remote update with no
side effects when a newly introduced envelope has the wrong document, envelope,
schema, backend, or story-sequence identity; a checkpoint from an unknown,
future, or unverifiable lineage; malformed/non-canonical base64url; or no
resolvable absolute position. An older checkpoint remains valid only when retained coverage proves
it is an ancestor and the relative position resolves.

After a later deletion, an existing explicit formatting endpoint that no longer
resolves makes its range record dormant: it projects no range and is not
rewritten. An existing annotation endpoint uses deletion mapping to collapse to
the consumed range's boundary and marks the annotation detached; if no such
boundary can be proved, it resolves to `null` and detached.
Wrong-document/version/sequence annotation envelopes are rejected on load or
input, never detached or rebound. No stale or unresolvable endpoint may attach
to unrelated text.

## Representation-neutral winner contract

The bake-off winner MUST expose a deterministic read-only
`FormattingEvidence[]` projection to the semantic store:

```ts
type FormattingEvidence = {
  evidenceVersion: 'formatting-evidence/2'
  evidenceCreationIds: readonly CreationId[]
  semanticMarkIds: readonly SemanticMarkId[]
  actorIds: readonly ActorId[]
  commitIds: readonly CommitId[]
  kind: 'bold' | 'italic'
  authoredIntentFingerprint: string
  resolvedSegments: readonly {
    storySequenceCreationId: CreationId
    globalStart: number
    globalEnd: number
  }[]
}
```

Arrays are sorted by canonical byte order and deduplicated; resolved segments
are half-open, ordered, non-overlapping for one evidence item, and clipped at
paragraph boundaries. `globalStart`/`globalEnd` are ephemeral projection output,
not persisted endpoint currency. `authoredIntentFingerprint` proves authored
omission/raw lexical intent from the canonical authored fixture; it is not a
replacement storage field. Canonical mark projection, normalized mark ID
derivation, repair, `ModelChange`, local/Yjs parity, and the v2 oracle consume
only this contract. No authoritative pre-bakeoff requirement may depend on
Candidate A or Candidate B storage topology.

## Formatting A/B falsification (must precede v2 oracle)

Task 2.4 implements an isolated, disposable comparison from identical fixtures:

### Candidate A — native `Y.Text` formatting

The isolated task 2.4 implementation is frozen exactly:

- `bodySequence` attribute keys are exactly `bold` and `italic`.
- Enable resolves the paragraph-local API range to a global sequence range and
  calls
  `bodySequence.format(globalStart, length, { [key]: contributionId })`.
  `key` is `bold` or `italic`; the value is a collision-free
  `ContributionId` string.
- A creation-only `formattingMetadata:
  Y.Map<ContributionId, PlainJsonRecord>` stores exactly `semanticMarkId`,
  `actorId`, `commitId`, and `kind`. A unique key is inserted once and MUST
  never be overwritten or deleted.
- Disable resolves the paragraph-local API range to the global sequence and
  calls `bodySequence.format(globalStart, length, { [key]: null })`.
- Projection reads ordered `bodySequence.toDelta()` segments. Active `bold` and
  `italic` `ContributionId` string values map through `formattingMetadata` to
  half-open text-only resolved ranges, clip at paragraph boundaries, and merge
  only in canonical authored projection. An unknown metadata ID or metadata
  `kind` unequal to the attribute key rejects the staged update atomically.
  Each maximal canonical segment derives its normalized ID from
  `"engine-core-spike-native-format-v2"`, kind, sorted active ContributionIds,
  and the zero-based segment ordinal for that exact ID set. Metadata preserves
  semantic mark ID and actor/commit provenance.
- `formattingMetadata` is creation-only experiment evidence outside
  `Y.UndoManager`; formatting history itself is the tracked `bodySequence`.

Candidate A is expected to expose whether native same-key formatting loses
multiple overlapping owners or lets an observed disable erase an unseen enable.
Those cases MUST be tested directly and MAY fail Candidate A. No second mutable
mark store, ownership side channel, custom conflict merge, compensating rewrite,
or other special workaround is allowed.

### Candidate B — immutable range contributions (task 2.4 winner, authoritative)

Use the creation-only add/remove records specified below. Task 2.4 selected this
representation; task 2.5 v2 oracles freeze it as the sole formatting storage
topology. Loser Candidate A evidence remains isolated under task 2.4 only.

### Exact winner criteria

Both candidates run the same seeds, operation groups, delivery orders,
snapshot/reopen checkpoints, and closed limits. A candidate is eligible only if
all criteria pass without hidden destructive normalization:

1. overlapping same-kind edits preserve the other actor's work through
   actor-local undo;
2. disabling causally observed formatting does not disable an unseen concurrent
   enable;
3. bold and italic remain independent under overlap, undo, and merge;
4. endpoints/coverage follow text through insert, delete, split, and join;
5. deterministic semantic mark IDs and complete actor/commit/creation
   provenance survive convergence;
6. authored omission and raw lexical intent survive projection/export/reopen;
7. undo, reopen, and redo preserve untracked remote/repair work and manager
   stack semantics;
8. normalization performs no destructive write to actor-authored formatting
   history;
9. replicas converge under every delivery order and seeded run; and
10. all closed resource bounds pass.

If exactly one candidate passes, it wins. If both pass, choose the lower maximum
encoded snapshot + aggregate update bytes across the frozen corpus; if still
tied, choose the lower maximum projection work count; if still tied, prefer
Candidate B for explicit causal provenance. If neither passes, task 2.5 is
blocked and schema v2 MUST NOT be frozen.

## Candidate B detail: mark contributions (authoritative)

Marks are not relative-endpoint maps rewritten by normalization. They are stable
**add** and **remove** contribution records in `markContributions`, uniquely
keyed by `ContributionId` (collision-free creation identity).

### Add contribution

- `kind: 'add'`
- `markKind: 'bold' | 'italic'` (spike)
- `storyId`, `markKind`, `actorId`, `commitId`
- `relativeStart`, `relativeEnd`: `RelativeEndpointEnvelopeV2`
- `proposedSemanticMarkId`
- immutable after insert

### Remove contribution

- `kind: 'remove'`
- `storyId`, `markKind`, `actorId`, `commitId`
- `relativeStart`, `relativeEnd`: `RelativeEndpointEnvelopeV2`
- `targetAddContributionIds`: sorted unique non-empty list of at most 256 add
  contribution IDs, each causally observed by this replica at insert time
- immutable after insert

**Target semantics:** a remove contribution subtracts only the intersection of
its resolved half-open range with each listed add contribution having the same
story and mark kind. A missing target, target of another kind/story, duplicate
target, unobserved target, empty target list, or list above 256 rejects the
whole transaction. There is no wildcard remove. Adds not observed and listed
when the remove is inserted remain enabled after merge. No actor overwrites or
deletes another actor's contribution record.

### Canonical mark projection

Authored bold/italic ranges are a deterministic pure function of:

```
bodySequence order + boundary embeds + markContributions (+ repair evidence)
```

Projection resolves contribution envelopes to absolute sequence positions,
orders the pair, and clips the range at every boundary item. Boundary embeds are
never included in mark coverage; a resolved range crossing boundaries becomes
one paragraph-local projected segment per non-empty text intersection. An
inverted, empty, dormant, or wholly embed-only range projects nothing.

For each maximal normalized segment, `semanticMarkId` is derived
deterministically as:

```
hash(
  "engine-core-spike-mark-v2",
  markKind,
  sorted active add ContributionIds,
  sorted clipping remove ContributionIds,
  zero-based segment ordinal for that exact contributor set
)
```

The ordinal is assigned by resolved sequence order after clipping. Proposed mark
IDs remain immutable provenance but never select the canonical normalized ID.
Overlapping bold/italic contributions compose independently by mark kind;
normalization does not collapse or rewrite source contributions.

## Canonical paragraph projection

Paragraphs are a deterministic projection of boundary embed order:

- Paragraph *i* is bounded by `boundaryEmbedᵢ` (start) and `boundaryEmbedᵢ₊₁`
  (end), with text = UTF-16 content strictly between them.
- Split: new boundary at offset → two paragraphs; first keeps projected
  survivor paragraph ID, tail mints new ID (R8).
- Join: remove one boundary → one paragraph; survivor ID is the first block's
  projected ID.

Concurrent boundary embeds at the same Yjs position follow converged Yjs item
order. Every boundary remains observable, including adjacent boundaries that
project a zero-text paragraph. If boundaries propose the same block, paragraph,
or text-span ID, the lowest lexicographic
`(actorId, commitId, creationId)` tuple retains the proposal and every loser
receives a deterministic derived ID. Projection never deletes, moves, or
rewrites a boundary to resolve the collision.

`DocumentModel.authored` is always this projection; the coordinator commits
`ModelChange` from projected state, never from raw Yjs structure alone.

## Normalization and repair (non-destructive)

Deterministic repair still runs after merge (R7) but MUST NOT destructively
rewrite history-scoped, actor-authored containers:

- Boundary embed payloads are immutable.
- Winner-owned formatting provenance/records are immutable; native attributes
  may change only through tracked semantic formatting transactions, never repair.
- `bodySequence` text edits remain CRDT merges; repair does not replace whole
  nested shared types.

**Persisted repair** appends immutable records under
`meta.repairEvidence: Y.Map<RepairEvidenceKey, PlainJsonRecord>`.
`RepairEvidenceKey` is
`hash("repair-v2", repairKind, proposedSemanticId, sorted involved CreationIds)`.
The value contains that complete key input, selected survivor, derived mappings,
actor/commit provenance, and normalization version. Inserting an absent key is
monotonic; inserting identical canonical bytes is idempotent; different bytes at
an existing key reject atomically. Repair MUST NOT update/delete evidence,
boundary embeds, winner-owned formatting history, story text, or another actor's
data. Repair evidence is outside `UndoManager` tracked types and undo/redo scope.

Collision candidates remain observable until actor/commit-ordered repair selects
a survivor mapping; the v1 pattern of deleting losing creation records is
forbidden.

## Undo / redo (`Y.UndoManager`)

Per actor session:

- One public `Y.UndoManager` instance scoped to:
  - the body story's `bodySequence` `Y.Text`
  - only additional winner-tracked types frozen by the task 2.5 oracle
- Stable per-actor+session origin token on every tracked transaction
- Explicit `stopCapturing()` at semantic group boundaries (IME commit, split,
  join, mark toggle batch, schema command)

**Excluded from tracked types:** `allocator`, `audit`, awareness payloads,
`capsules`, `meta.repairEvidence`, untracked formatting-evidence metadata, and
`storyOrder`/story metadata maps.

**Durable undo:** retain the bounded public-API reconstruction journal
(experiment-verified) so snapshot/reopen restores eligible undo/redo stacks
without requiring Yjs persistence of manager internals. Journal records reference
stable operation descriptors sufficient to rebuild manager state idempotently.

**Redo semantics:** untracked remote and repair transactions preserve the
current redo stack. A new eligible tracked transaction clears redo only on the
`Y.UndoManager` for the same actor + session. Transactions from another actor or
another session do not clear it. Undo and redo availability, pop order, and
empty-stack behavior are exactly the public manager's `undoStack`/`redoStack`
semantics after explicit capture boundaries; no parallel application-managed
stack may override manager controls.

**Local backend parity:** mirror the same session-local manager stack behavior,
including redo preservation by remote/repair/other-session activity and
same-session tracked invalidation, identity restoration, and reopen behavior;
do not require `Y.Text`/embed topology in the local store.

## Identity and affinity (frozen)

| Operation | Rule |
| --- | --- |
| Split | Survivor paragraph ID stays on the first fragment; tail mints new paragraph/block/text-span IDs |
| Join | Surviving ID is the first paragraph's projected ID |
| Move | IDs unchanged (spike: not in scope beyond boundary reorder evidence) |
| Block replace | Mints new IDs (capsule path only in spike) |
| Delete + undo | Restores original projected IDs when undo reverses the deleting actor's eligible mutations |
| Concurrent split/delete | Resolved by deterministic repair pass ordering (delete before split/join when targets no longer survive) |

**Formatting and annotation positions:** annotation endpoints and Candidate B
range endpoints are `RelativeEndpointEnvelopeV2`, never numeric offsets.
Half-open paragraph-local UTF-16 positions exist only as API input and are
converted during commit preflight. Candidate A coverage is native Y.Text
formatting over sequence items and persists no numeric endpoint. Projection for
either winner clips marks by boundary embeds. Annotation deletion/collapse/
detach follows the stale/unresolvable rules above.

## Trust boundary and resource limits (closed)

All v2 backend entry points enforce:

| Limit | Spike ceiling |
| --- | --- |
| Max reconstruction-journal events | 64 |
| Retained journal horizon | 48 events |
| Max undo entries per actor session | 32 |
| Max redo entries per actor session | 32 |
| Max actor sessions per document | 16 |
| Max replication update size | 256 KiB |
| Max genesis payload | 4 MiB |
| Max aggregate replay bytes | 4 MiB |
| Max snapshot size | 8 MiB |
| Max `bodySequence` length | 256 KiB UTF-16 units |
| Max boundary embed count | 4096 |
| Max formatting-evidence source records | 8192 |
| Max causal-disable targets where used | 256 |
| Max repair evidence records | 4096 |
| Max canonical embed payload | 4 KiB per boundary |
| Max validation nesting | 4 |

Before applying bytes or mutating canonical/Yjs state, preflight decodes into a
staging document and validates the prospective aggregate state against every
limit, envelope binding, plain-JSON/embed rule, origin rule, and schema version.
Journal retention is bounded to 64 stored events with only the newest 48
eligible for reconstruction; undo/redo stacks are independently capped at
32/32 per session. Any single or aggregate breach, malformed input, allocator
exhaustion, or unverifiable endpoint rejects the entire transaction/update/
restore atomically: no Yjs commit, canonical revision, repair evidence, journal
append, history change, notification, audit cursor, or emitted update. Awareness
and audit channels remain non-authoritative.

## Named v2 proof scenarios

The lean task 2.5 artifacts catalog these scenarios as action/assertion
descriptors before backend/history implementation. They intentionally contain
no precomputed canonical states or descriptor hashes presented as semantic
fingerprints. Tasks 2.6–2.8 and 3.x write direct executable expected-state
assertions test-first for the behavior they own.

| Gate | Proves |
| --- | --- |
| **G-v2-1 Same-tail split remote undo** | Actor A splits tail; actor B edits tail; A undoes split; reopen; redo — B's edit survives; IDs and manager-stack transitions satisfy task 2.8 assertions |
| **G-v2-2 Join both ranges** | Concurrent joins on adjacent boundaries converge; undo/redo restores actor-local join eligibility |
| **G-v2-3 Concurrent boundaries** | Two actors insert boundaries at same text offset; merge + projection deterministic; no nested type creation |
| **G-v2-4 Overlapping bold/italic** | Winner preserves same-kind actor-local undo and bold/italic independence under overlap |
| **G-v2-5 Observed disable vs unseen enable** | Winner disables observed formatting only; unseen concurrent enable survives merge and undo |
| **G-v2-6 Endpoint affinities** | Versioned relative envelopes follow assoc/affinity; wrong-doc, stale, and unresolvable cases reject/detach exactly as frozen |
| **G-v2-7 No nested shared types on split/mark** | Split/join/format ops create zero `Y.AbstractType` children; boundaries are length-1 plain JSON embeds and any winner records are plain JSON |
| **G-v2-8 No destructive normalization** | Post-merge repair never rewrites winner-owned formatting history or embed payloads; repair evidence is monotonic |
| **G-v2-9 Local/Yjs parity** | Task 2.7 directly compares local and Yjs canonical outputs for each applicable scenario |
| **G-v2-10 Durable compaction** | Limits, compaction, snapshot + bounded journal replay restore manager stack eligibility and canonical state |

Passing G-v2-1..G-v2-10 is necessary for task 2.8 (actor-local history); passing
historical v1 task 2.2 acceptance is not sufficient.

## Lean contract artifacts (frozen task 2.5)

| Artifact | Purpose |
| --- | --- |
| `oracles/yjs-schema.v2.json` | Root keys, embed schema, selected formatting representation, repair evidence, limits |
| `oracles/binding-oracle.v2.json` | IME, selection affinities, grouping boundaries aligned to sequence model |
| `oracles/history-oracle.v2.json` | G-v2-1..G-v2-10 action/assertion catalog and owning implementation tasks |
| `oracles/comparator-contracts.v2.json` | Canonical input schemas and serialization rules for future direct comparisons |

Artifact self-hashes are integrity checks only, not correctness approval.
Compatibility filenames do not imply exhaustive preimplementation outputs. v1
oracle files remain read-only historical references until explicitly archived.
