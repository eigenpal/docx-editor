## ADDED Requirements

### Requirement: The adapter-facing surface exposes no engine types

An adapter SHALL drive the editor through `Editor` (the facade) and supply
`EditorHost`. Whatever else the contract exposes, no member of the public
surface SHALL reference an editing-engine or layout-internal type. The surface
is deliberately open-ended and expected to grow; this requirement constrains
what it must NOT leak, not an exact member count.

#### Scenario: A consumer builds the editor without engine types

- **WHEN** an adapter constructs an `Editor` through `createEditor({ host })`
- **THEN** it supplies only DOM handles, frame scheduling, and event callbacks
- **AND** no member of `Editor` or `EditorHost` references an editing-engine or
  layout-internal type

### Requirement: The facade answers geometry as queries

`Editor` SHALL expose `getDisplay`, `getSelectionRects`, `getCaretRect`,
`hitTest`, `getPageGeometry`, and `getScrollGeometry`. Selection and caret
geometry are derived from current state, not carried in the render list.

#### Scenario: Pointer handling resolves without an engine coordinate

- **WHEN** the adapter passes a client-space point to `hitTest`
- **THEN** it receives a PM-free semantic hit target carrying frame identity,
  scope, stable semantic identity, position or atomic target, and affinity
- **AND** it never reads or constructs an engine position

#### Scenario: Selection overlays read content-space rectangles

- **WHEN** the adapter renders a selection or caret
- **THEN** it reads rectangles from `getSelectionRects` / `getCaretRect`
- **AND** it does not measure painted DOM to recover geometry

### Requirement: Core emits a positioned render list

The engine SHALL lay the document out and deliver `DisplayPage[]` through
`getDisplay`, the `display` event, and `EditorHost.onDisplay`. A page is a box
and an ordered `DisplayItem[]`. The adapter paints items positionally and
performs no measurement or layout.

#### Scenario: The host receives pages to paint

- **WHEN** layout changes
- **THEN** the host's `onDisplay` receives the new `DisplayPage[]`
- **AND** the host supplies no measurement callback to produce them

### Requirement: PM-free semantic positions are the only positions crossing the boundary

Every content-bearing `DisplayItem` SHALL carry or reference a PM-free semantic
range with scope, stable semantic identity, position/atomic-target semantics,
and affinity as applicable. Selection SHALL map to geometry through the
revision-tagged interaction frame and engine geometry queries, not through
ProseMirror positions, browser DOM ranges, or accumulated display-item lengths.

#### Scenario: Selection maps to painted content

- **WHEN** the current selection covers a range
- **THEN** its rectangles are resolved from the interaction frame's semantic
  position/cluster index within the matching scope and revision
- **AND** the adapter holds no engine position at any step

### Requirement: The contract adds no test surface of its own

This change SHALL add declarations and design but no runtime test surface. Its
acceptance is the contract package's own typecheck and the consumer type test;
it introduces no additional test suites.

#### Scenario: Acceptance is typecheck-only

- **WHEN** the change is verified
- **THEN** the core contract package typechecks and the consumer type test
  passes
- **AND** no new test files are added for it
