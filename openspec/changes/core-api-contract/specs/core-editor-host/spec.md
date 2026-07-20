## ADDED Requirements

### Requirement: DOM handles are supplied as getters

`EditorHost` SHALL expose DOM handles as getter functions (`getBodyHostEl`, `getHfHostEl`, `getPagesContainer`, `getScrollContainer`), not as values captured at construction, because every handle is null through first render and the scroll container can change identity between renders.

#### Scenario: Editor created before the container mounts

- **WHEN** an editor is created while `getPagesContainer()` still returns null
- **THEN** creation SHALL succeed, and the engine SHALL paint once the getter returns an element

#### Scenario: Scroll container identity changes

- **WHEN** the adapter re-renders and `getScrollContainer()` returns a different element
- **THEN** the engine SHALL use the current element without requiring the editor to be recreated

#### Scenario: Host reports no scroll container

- **WHEN** `getScrollContainer()` returns null
- **THEN** the engine SHALL operate without scroll restoration rather than failing

### Requirement: Two-phase scheduling

`EditorHost` SHALL provide `scheduleFrame` to coalesce engine work, and MAY provide `afterCommit` to run work once the adapter has flushed its own render. Engine paint and adapter commit are distinct moments and SHALL NOT be conflated.

#### Scenario: Multiple edits in one frame

- **WHEN** several edits are dispatched before the next frame
- **THEN** the engine SHALL relayout once, not once per edit

#### Scenario: Host omits afterCommit

- **WHEN** a host does not implement `afterCommit`
- **THEN** the engine SHALL still function, forgoing only the work that requires post-commit timing

#### Scenario: Headless host

- **WHEN** a host supplies a synchronous `scheduleFrame` that invokes its callback immediately
- **THEN** the engine SHALL complete layout synchronously, so it can run without a frame loop

### Requirement: Measurement is injected

`EditorHost` SHALL supply `measureBlocks`. The engine SHALL NOT assume it can measure content itself while this member exists.

#### Scenario: Adapter supplies a caching measurer

- **WHEN** an adapter provides a memoizing `measureBlocks`
- **THEN** the engine SHALL use it for every measurement pass rather than an internal measurer

### Requirement: Commands are scoped

The editor SHALL model N+1 editing surfaces: one body plus one per header/footer relationship. `exec`, `can`, `query`, and `snapshot` SHALL accept an explicit `EditorScope`, defaulting to the active scope.

#### Scenario: Command issued while a header has focus

- **WHEN** a header is the active scope and a formatting command is issued without an explicit scope
- **THEN** it SHALL apply to that header, not to the body

#### Scenario: Command names a scope explicitly

- **WHEN** a command supplies `{ scope: { kind: 'body' } }` while a header is active
- **THEN** it SHALL apply to the body

#### Scenario: Aggregate scope used for a write

- **WHEN** a write supplies `{ scope: { kind: 'all' } }`
- **THEN** it SHALL fail with code `invalidArgs`, since `all` is a read-only aggregate

#### Scenario: Aggregate scope used for a read

- **WHEN** `query` requests tracked changes with `{ scope: { kind: 'all' } }`
- **THEN** the result SHALL span the body and every header and footer surface

### Requirement: Cache invalidation is not a public operation

The public surface SHALL NOT expose functions that reset module-scope measurement or paint caches. Callers needing a recomputation SHALL use `relayout`.

#### Scenario: Caller forces a recomputation

- **WHEN** a caller invokes `editor.relayout({ sync: true })`
- **THEN** layout SHALL be recomputed for that editor instance only

#### Scenario: Two editors on one page

- **WHEN** two editors exist and one relayouts
- **THEN** the other SHALL be unaffected, since no shared module-scope cache is reset

#### Scenario: Web fonts finish loading

- **WHEN** `document.fonts` signals `loadingdone`
- **THEN** the engine SHALL invalidate its own measurements and relayout, without the adapter subscribing to that event
