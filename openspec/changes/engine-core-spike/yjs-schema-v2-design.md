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

The sequence grammar is:

```
[ openingBoundary₀, text₀, openingBoundary₁, text₁, …, openingBoundaryₙ, textₙ ]
```

- **Opening boundary embeds** are plain immutable JSON values inserted only with
  `Y.Text.insertEmbed`. They MUST NOT be `Y.XmlElement`, `Y.Map`, `Y.Array`,
  `Y.Text`, or any other `Y.AbstractType`, directly or recursively.
- **Text runs** are plain UTF-16 insertions after an opening boundary and before
  the next opening boundary or sequence end.

The sequence MUST begin with one opening boundary and contain at least one
opening boundary. Each opening boundary starts exactly one paragraph. The final
paragraph ends at sequence end; there is no terminal sentinel.

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

Split inserts one new opening boundary at the split offset within the paragraph
text span. Join deletes exactly one non-first opening boundary. Identity rules
(R8, below) apply to projected paragraph IDs, not to mutating embed payloads.

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
Validation order is fixed. First bound the containing payload. Then, before any
decode allocation, require an ASCII string, enforce the 349526-character bound,
match `^[A-Za-z0-9_-]+$`, reject padding/whitespace, and require
`length % 4 !== 1`. Allocate only a decoded buffer bounded to 256 KiB, then
require exact canonical base64url re-encoding. Only after those checks may the
public Yjs relative-position decoder run, followed in order by
document/envelope/schema/backend/story binding, checkpoint lineage, and absolute
resolution checks. Decoded bytes are ephemeral decoder input and are never
stored in authored state, envelopes, snapshots, journals, or audit records.

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

Derivation first resolves add/remove endpoint ranges and clips them at opening
paragraph boundaries. It partitions text at every add endpoint, remove
endpoint, and paragraph endpoint. For each interval and mark kind, active add
IDs are intersecting add IDs not subtracted on that interval by a valid remove
targeting them; clipping remove IDs are removes that subtract a targeted add on
that interval. Intervals with no active adds are omitted. Adjacent intervals
merge if and only if kind, active add IDs, clipping remove IDs, and
`authoredIntentFingerprint` are identical.

Each resulting maximal group emits one evidence item. `evidenceCreationIds` is
the sorted union of active add IDs and clipping remove IDs. `semanticMarkIds`
is the sorted proposed-ID set from active adds. `actorIds` and `commitIds` are
the sorted provenance sets from all `evidenceCreationIds`. `resolvedSegments`
are the group's clipped, ordered, non-overlapping half-open intervals.
All ID/provenance arrays sort by canonical UTF-8 byte order and deduplicate.
`globalStart`/`globalEnd` are ephemeral projection output, never persisted
endpoint currency.

All SHA-256 derivations use explicit framing. A scalar string is its unsigned
uint32be UTF-8 byte length followed by its UTF-8 bytes. An array is unsigned
uint32be element count followed by each UTF-8 element as unsigned uint32be byte
length plus bytes. The zero-based segment ordinal is an unsigned uint32be;
overflow rejects atomically. Arrays sort by canonical UTF-8 byte order before
framing. Digests are lowercase hexadecimal.

## Formatting A/B falsification (reviewed KISS authority)

The authoritative task 2.4 procedure is the direct `yjs-formatting-kiss.ts`
experiment. It runs exactly `overlap-undo`, `observed-disable`,
`mark-independence`, `endpoint-affinity`, `split-tail`, and `reopen-history`.
Each candidate starts from the same reset deterministic per-role client-ID
schedule. Every concurrent case is exchanged in both delivery orders. The six
cases directly assert the represented overlap, causal disable, independent
marks/provenance/authored intent/read-only normalization, endpoint affinity,
split-tail/join convergence, and reopen undo/redo semantics.

Resource evidence is direct: at most 16 formatting records and at most 20,000
encoded Yjs bytes in the bounded split-tail case, collision-free scenario client
IDs, and exact byte accounting over genesis-excluded source-operation updates
plus terminal `Y.encodeStateAsUpdate` snapshots. A candidate is eligible only if
all six cases pass. If both pass, lower measured real-Yjs bytes wins; an exact
byte tie selects Candidate B. If neither passes, v2 remains blocked.

The abandoned `experiments/yjs-formatting-bakeoff/oracle/**` corpus, seeded or
frozen-corpus procedures, claims to cover every v2 limit, and projection-work
tie-break are unexecuted non-authoritative historical work and MUST NOT be
consumed.

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

Projection follows the complete `FormattingEvidence` derivation above.
Boundary embeds are never included in mark coverage. Inverted, empty, dormant,
wholly embed-only, and no-active-add intervals project nothing.

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

Paragraphs are a deterministic projection of opening boundary order:

- Opening boundary *i* starts paragraph *i*. Its text continues until opening
  boundary *i+1* or sequence end. There is no terminal sentinel.
- Split: new boundary at offset → two paragraphs; first keeps projected
  survivor paragraph ID, tail mints new ID (R8).
- Join: remove one non-first opening boundary → one paragraph; survivor ID is
  the first block's projected ID.

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
| **G-v2-6 Winner formatting endpoints** | Task 2.8 proves contribution-range assoc/affinity, wrong binding rejection, retained-ancestor resolution, and stale/unresolvable existing formatting ranges becoming dormant without rewrite. Selection and annotation behavior belongs to tasks 3.2 and 4.3, not this gate. |
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
