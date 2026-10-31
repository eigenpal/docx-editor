## ADDED Requirements

### Requirement: A busy room compacts without every participant leaving

A server SHALL be able to compact a room while participants are connected, by replacing its generation with one built from the materialized package. The server SHALL hold the room's writer lock during the reset, swap the new generation in with compare-and-swap, close clients on the old generation with code 4409, and keep the old generation until the new one is stored and reopened.

#### Scenario: Reset with connected participants

- **WHEN** a reset is due and two participants are connected
- **THEN** both are closed with code 4409, rejoin the new generation, and see the same document as before the reset

#### Scenario: Swap fails

- **WHEN** the stored generation changed between the build and the swap
- **THEN** the old generation stays in place, the lock is released, and no participant is closed

### Requirement: No participant loses an edit to a live reset

The server SHALL announce a live reset before it takes the writer lock. A client that supports the announcement SHALL hold local edits made during the reset and replay them on the new generation.

#### Scenario: Edit made during the reset

- **WHEN** a participant types after the server announces the reset and before it rejoins
- **THEN** the client holds the edit, replays it on the new generation, and every participant sees it after the reset

#### Scenario: Held edit whose target is gone

- **WHEN** a held edit names content that the new generation no longer holds
- **THEN** the client refuses it through the normal rejection path and does not drop it silently

#### Scenario: Released client during the lock

- **WHEN** a client that does not support the reset message sends an update while the server holds the writer lock
- **THEN** the update is refused with code 4409, and the client rejoins as after a load-time compaction

### Requirement: Compaction triggers on reclaimable state

A reset SHALL be due when reclaimable records, unreferenced blob bytes, or state bytes cross their configured thresholds, each measured against a fresh build. The flagged tombstone count SHALL NOT be the only measure of reclaimable records.

#### Scenario: Blob-heavy room with garbage records

- **WHEN** state is less than twice a fresh build but reclaimable records exceed their threshold
- **THEN** a reset is due

### Requirement: Any room a session can reach can be compacted

The compaction path SHALL admit the same blob total as a live room. A build that still refuses SHALL report the reason to the host and leave the room unchanged.

#### Scenario: Room above the open-file limit

- **WHEN** a room's package expands above the limit for opened files but within the room's blob cap
- **THEN** compaction builds the new generation

#### Scenario: Build refuses

- **WHEN** a fresh build refuses
- **THEN** the host receives `baseline-too-large` or the build's own reason, and the room keeps its current generation

### Requirement: Hosts can see room growth before a cap ends the room

`resourceUsage()` SHALL report reclaimable records, referenced blob bytes, and whether the room is compactable, with a reason when it is not. A server SHALL be able to register a hook that fires when a configured share of a cap is reached.

#### Scenario: Threshold reached

- **WHEN** a room reaches the configured share of `maxNodes` or of the blob cap
- **THEN** the hook receives the room's resource usage, including reclaimable and referenced amounts

### Requirement: Compaction keeps the collaboration format

A reset SHALL produce a generation in the current collaboration format, and SHALL NOT require a saved-room migration. Released clients SHALL rejoin the new generation through the existing generation gate.

#### Scenario: Released client during a reset

- **WHEN** a client from the previous release is connected during a reset
- **THEN** it is closed with code 4409, rejoins, and edits the new generation
