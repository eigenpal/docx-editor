## ADDED Requirements

### Requirement: rAF-coalescing layout scheduler

The engine SHALL expose `scheduleLayout(state)` that coalesces rapid layout requests into a single pass per animation frame via the host's `scheduleFrame`. Multiple `scheduleLayout` calls before the frame fires SHALL collapse to one `run` with the latest state. Both adapters SHALL route doc-changing transactions through `scheduleLayout` instead of relaying out synchronously.

#### Scenario: Rapid transactions collapse to one paint

- **WHEN** five doc-changing transactions fire within one animation frame (e.g. typing "hello")
- **THEN** `run` executes once with the final state, not five times

#### Scenario: Vue perf gap closed

- **WHEN** the Vue adapter adopts the scheduler
- **THEN** Vue no longer relayouts synchronously per keystroke; it coalesces like React

#### Scenario: Latest state wins

- **WHEN** `scheduleLayout(A)` then `scheduleLayout(B)` are called before the frame fires
- **THEN** the single layout pass uses state B

#### Scenario: Synchronous host runs immediately

- **WHEN** the host's `scheduleFrame` invokes its callback synchronously
- **THEN** `scheduleLayout` lays out immediately and deterministically (for tests)
