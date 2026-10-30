## Context

`full-document-yjs-collaboration` decided two things that shape this change. D15 keeps every node record forever, because `replacedBy` lets a concurrent child move to the survivor, and an offline peer may still hold edits that name a deleted record. D17 replaces destructive room state with a new generation, and it shipped only at load time: a server compacts a stored room in `onLoadDocument`, when the room is empty and nothing can write.

The caps live in `packages/pro/src/collaboration/document/limits.ts` (`maxNodes` 200,000, `maxBlobBytes` 32 MiB per blob) and `shared-blob-store.ts` (`MAX_SHARED_BLOB_BYTES` 64 MiB). `limitFailure` counts `registry.nodeCount()`, which includes every record, and `totalByteLength()`, which includes unreferenced blobs. It runs on every received edit and on join, and a failure sets the terminal status `error`.

## Goals / Non-Goals

**Goals:**

- A room that stays busy for days can shed its garbage without anyone leaving it.
- A host sees growth, and how much of it is reclaimable, before a cap ends the room.
- Any room that a live session can reach can also be compacted.
- No collaboration format change, and no migration of saved rooms.

**Non-Goals:**

- Compaction for WebRTC rooms. They have no single writer to coordinate a reset.
- Keeping undo history across a reset.
- Deleting records in place.

## Decisions

### D1: Compact by generation reset, not by deleting records

A reset builds generation N+1 from the materialized package and replaces N. Deleting tombstoned records in place was rejected: an offline peer that rejoins with an edit naming a deleted record would fail to apply it, and released readers expect every referenced id to exist. That alternative would be `migration-required` (`sharedSchemaVersion` and `repairVersion`), and it still would not reclaim blob bytes.

### D2: The server coordinates a live reset with the shipped gate

1. The server decides a reset is due (D3) and takes the room's writer lock. While it holds the lock, it accepts no new updates; it queues them for N.
2. It materializes the package from N, builds N+1 with `seedGeneration`, and validates N+1 with the fresh-build checks that load-time compaction uses.
3. It swaps N+1 in with compare-and-swap on the stored generation id. A failed swap leaves N in place and releases the lock.
4. It closes clients on N with code 4409 (`room-generation-changed`). Each client reconnects and joins N+1. Queued updates for N are refused, as after a load-time compaction.
5. It keeps N for rollback until N+1 has been stored and reopened once.

The spike in `__tests__/generation-spike/` already proves the lock, compare-and-swap, and rollback; production code reuses that shape. Released clients already handle 4409, so this is a `compatible` change.

Alternative considered: a client-led reset. Rejected, because any participant could then end every other participant's undo history, and two concurrent resets need a single arbiter anyway.

### D3: Trigger on reclaimable records, unreferenced blobs, and bytes

A reset is due when any of these crosses its threshold, each measured against what a fresh build would contain:

- reclaimable records (`nodes` minus fresh records), as a share of `maxNodes`;
- unreferenced blob bytes, as a share of the 64 MiB blob cap;
- state bytes over fresh bytes, the existing `minimumGain` rule.

Measuring the fresh build needs a materialization, so the server samples it on a schedule and after large events (bulk accept or reject, image deletion), not on every update. The flagged tombstone count is not a trigger: it reported 794 of 4,449 reclaimable records in the benchmark.

### D4: One ceiling for growth and for compaction

The compaction path accepts the same blob total as a live room. `MAX_BASELINE_BYTES` (20 MiB) bounds files a user opens; a reset reads a package the room already admitted, so it uses the room's own limits. A build that still refuses reports `baseline-too-large` through the server hook and leaves N in place. The example server stops discarding that error.

### D5: Observability before policy

`resourceUsage()` adds `reclaimableNodes`, `referencedBlobBytes`, and `compactable` (with a reason when false). A server option, `onResourceUsage(threshold, usage)`, fires when a configured share of a cap is reached. The telemetry server sample and the example `/rooms` route report the same fields. This ships first, because it is local, cheap, and tells hosts how close their rooms are.

### D6: Interim cap policy is optional and keeps a backstop

Counting only reachable records against `maxNodes` and only referenced bytes against the blob cap turns a scheduled failure into ordinary cost. It is local policy: every replica decides alone, and no shared data changes meaning. Because it lets raw state grow, a second cap on raw totals (proposed at four times the current values) stays in place, so a hostile or runaway peer is still bounded. A reachable count needs a walk or an incrementally kept index; the walk runs on the server sample from D3, not per update.

## Risks / Trade-offs

- **Undo loss on reset** → reset only when a trigger fires, prefer quiet periods (no update for a configured interval), and document it for hosts.
- **Edits lost in the reset window** → the writer lock queues updates and refuses them with 4409, so the client keeps them as unsent and the user sees the refusal; this matches load-time compaction today.
- **Materialization cost on large rooms** → sample on a schedule and after large events, and measure the cost on the 20,000-edit benchmark room before choosing intervals.
- **Interim policy hides growth** → keep the raw-total backstop and report raw totals in `resourceUsage()`.

## Migration Plan

No saved-room migration. Generation N+1 uses the current format, and rooms compact on their next reset or load. Rollback keeps generation N until N+1 is confirmed. Each implementation PR runs `bun run collaboration:change` with `compatible` and confirms with `bun run collaboration:test --all`.

## Open Questions

- Default thresholds for D3, to set from the benchmark room and production telemetry.
- Whether hosts can postpone a reset, for example during a review meeting.
- Whether the interim policy in D6 ships at all, or the live reset alone is enough.
