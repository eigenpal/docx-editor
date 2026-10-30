## 1. Observability

- [ ] 1.1 Add `reclaimableNodes`, `referencedBlobBytes`, and `compactable` with a reason to `resourceUsage()` and `readCollaborationResourceUsage`.
- [ ] 1.2 Add a server `onResourceUsage(threshold, usage)` hook.
- [ ] 1.3 Report the new fields from the telemetry server sample and the Hocuspocus example `/rooms` route.

## 2. Trigger and ceiling

- [ ] 2.1 Make the compaction trigger consider reclaimable records and unreferenced blob bytes as well as `minimumGain`.
- [ ] 2.2 Let the compaction path admit the room's blob total instead of `MAX_BASELINE_BYTES`.
- [ ] 2.3 Report `baseline-too-large` and other build refusals to the host; stop discarding them in the example server.
- [ ] 2.4 Measure materialization cost on the 20,000-edit benchmark room and set default thresholds and sampling intervals.

## 3. Live generation reset

- [ ] 3.1 Move the writer lock, compare-and-swap, and rollback from `__tests__/generation-spike/` into production code.
- [ ] 3.2 Add a server reset that builds generation N+1, swaps it in, closes generation-N clients with 4409, and keeps N until N+1 is confirmed.
- [ ] 3.3 Wire the reset into the Hocuspocus wrapper and the example server.
- [ ] 3.4 Test reset with connected participants, a failed swap, edits during the lock, and reconnect, with real sessions.
- [ ] 3.5 Record a `compatible` decision and run `bun run collaboration:test --all` against released clients.

## 4. Optional interim cap policy

- [ ] 4.1 Decide whether to ship it after task groups 1 to 3.
- [ ] 4.2 If it ships: count reachable records against `maxNodes` and referenced bytes against the blob cap, with a raw-total backstop.

## 5. Documentation

- [ ] 5.1 Document resets, undo loss, and the new resource fields in the collaboration server guide.
