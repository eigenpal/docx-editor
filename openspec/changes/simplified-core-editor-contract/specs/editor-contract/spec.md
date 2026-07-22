## ADDED Requirements

### Requirement: One framework-facing editor surface

The contract SHALL expose exactly two adapter-facing shapes — `Editor` (the
facade) and `EditorHost` (what the adapter supplies) — and no others. No editing
engine type appears on the public surface.

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
- **THEN** it receives a `DocPoint` of `{ docPos, scope }`
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

### Requirement: Document offsets are the only positions crossing the boundary

Every content-bearing `DisplayItem` SHALL carry `docFrom`, `docTo`, and a view
`scope`. Selection maps to geometry through these offsets alone.

#### Scenario: Selection maps to painted content

- **WHEN** the current selection covers a range
- **THEN** its rectangles are resolved from items whose `docFrom`/`docTo` bound
  the range within the matching `scope`
- **AND** the adapter holds no engine position at any step

### Requirement: The contract adds no test surface of its own

This change is declarations plus design. Its acceptance is the contract
package's own typecheck and the consumer type test; it introduces no additional
test suites.

#### Scenario: Acceptance is typecheck-only

- **WHEN** the change is verified
- **THEN** the core contract package typechecks and the consumer type test
  passes
- **AND** no new test files are added for it
