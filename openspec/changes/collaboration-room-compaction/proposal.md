## Why

A collaboration room only grows. Records are never map-deleted (`full-document-yjs-collaboration` design D15), and blob bytes stay in the shared blob map after the last reference goes. `limitFailure` counts both against `maxNodes` (200,000) and the 64 MiB blob cap on every received edit, and both failures end the room. For the long-lived, heavily redlined documents that collaboration exists for, growth plus hard caps is a failure with an unknown date. Issue #554 tracks it.

Part of the remedy shipped. A server compacts a room in `onLoadDocument` (`compactCollaborationState`, `room-generation.ts`), seeds a new generation, and the client gate closes stale clients with code 4409. `session.resourceUsage()` reports nodes, tombstones, and blob bytes. Measurement on a benchmark room shows what is still missing:

| Edits | Records | Flagged tombstones | Records after a fresh build | State | Fresh state | State / fresh |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 14,424 | 0 | 14,424 | 4.42 MB | 4.40 MB | 1.01 |
| 1,000 | 14,683 | 42 | 14,433 | 5.82 MB | 5.50 MB | 1.06 |
| 5,000 | 15,747 | 228 | 14,628 | 11.47 MB | 9.43 MB | 1.22 |
| 20,000 | 19,630 | 794 | 15,181 | 32.77 MB | 22.33 MB | 1.47 |

The run used one replica on `examples/vite/public/sample.docx`, with typing, deletions, tracked edits, bulk accept and reject, block split, join, and delete, formatting, and a 200 KiB image every 200 edits. The blob map held 19.89 MB, of which 16.82 MB was still referenced.

1. **A room that never empties is never compacted.** Compaction runs only when the server loads a room.
2. **The trigger misses real garbage.** Compaction requires stored state at least twice a fresh build. At 20,000 edits the ratio is 1.47, because blob bytes dominate; without blobs it is 2.34.
3. **The compaction ceiling is lower than the room ceiling.** A fresh build refuses a package above 20 MiB (`MAX_BASELINE_BYTES`), but a live room admits 64 MiB of blobs. The example server hides that refusal (`.catch(() => null)`).
4. **The tombstone count understates garbage.** A fresh build drops 4,449 records; only 794 carry the tombstone flag.
5. **Blob growth is the nearer cap.** Records grow by about 0.26 per edit, so `maxNodes` is about 690,000 edits away from this seed. The blob map never shrinks: 64 MiB is about 327 inserts of a 200 KiB image, including re-inserts, undo, and redo.

## What Changes

This change proposes a design. It ships no collaboration format change.

- **Live generation reset.** A server-coordinated reset compacts a room while participants stay connected. It reuses the shipped generation gate: the server takes a writer lock, builds generation N+1 from the materialized package, swaps it in with compare-and-swap, closes clients on generation N with code 4409, and keeps N for rollback until N+1 is confirmed. Clients reconnect and join N+1.
- **A trigger on garbage, not only bytes.** Compaction runs when reclaimable records, unreferenced blob bytes, or state size cross a threshold, each relative to a fresh build.
- **One ceiling.** The compaction path admits the same blob total as a live room, so a room that can grow can always be compacted. A build that still refuses reports `baseline-too-large` instead of failing silently.
- **Room-size observability.** `resourceUsage()` adds `reclaimableNodes`, `referencedBlobBytes`, and a `compactable` verdict. Servers get a threshold hook. The Hocuspocus example and the telemetry server sample report the new fields.
- **Interim cap policy, optional.** `maxNodes` counts reachable records and the blob cap counts referenced bytes, with a second, higher backstop on raw totals so a hostile or runaway peer is still bounded.

## Capabilities

### New Capabilities

- `collaboration-room-compaction`: compaction of a live room, its trigger, ceiling, observability, and the interim cap policy.

### Modified Capabilities

None. The `durable-collaboration-rooms` requirements in `full-document-yjs-collaboration` stay valid; this change adds the live path that its D17 decision deferred.

## Impact

- **Format:** no field increment. Generation N+1 uses the current `docx-collaboration:1.5.2.1` shape, and the 4409 gate already ships, so released clients reconnect correctly. Each implementation PR records a `compatible` decision, confirmed by `bun run collaboration:test --all`.
- **Behavior:** a reset ends every participant's undo history and briefly disconnects them. Unsent local edits from a client on generation N are refused, as they are after a load-time compaction today.
- **Packages:** `pro` (`room-generation.ts`, `resource-usage.ts`, `shared-blob-store.ts`, `document-bootstrap.ts`, `hocuspocus.ts`), `telemetry` server sampling, and `examples/collaboration-hocuspocus`.
- **Not in scope:** WebRTC rooms, which have no server to coordinate a reset; in-place deletion of records, which would break D15 adoption for offline peers.
- **Cost:** about 2 days for observability and the trigger and ceiling fixes, 5 to 8 days for the live reset, and 3 to 4 days for the optional interim cap policy.
