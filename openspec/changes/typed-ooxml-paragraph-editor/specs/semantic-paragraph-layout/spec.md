## ADDED Requirements

### Requirement: Native semantic layout records
The semantic layout engine SHALL produce revision-tagged page, paragraph-fragment, line, and style-span records directly from the committed canonical tree and derived style resources.

#### Scenario: Paragraph crosses a page
- **WHEN** a paragraph's measured lines exceed the remaining page content area
- **THEN** ordered paragraph fragments reference the same paragraph identity across the two resulting pages

### Requirement: Source-addressable lines and spans
Every line and style span SHALL retain stable story/paragraph identity and canonical UTF-16 source ranges sufficient for semantic navigation and selection.

#### Scenario: Mixed formatting is laid out
- **WHEN** a line contains adjacent text with different resolved run formatting
- **THEN** its style spans cover the line's source text in order without gaps or overlaps

### Requirement: Accepted paragraph layout boundary
Semantic layout SHALL resolve and represent the D8 run and paragraph property boundary, including authored whitespace, tabs, and hard breaks. Hyperlinks, fields, comments, tracked changes, images, tables, content controls, headers/footers, and notes SHALL remain outside this layout acceptance.

#### Scenario: Accepted properties affect layout and spans
- **WHEN** accepted run properties, paragraph spacing/indents/tabs/numbering, or pagination controls occur in the paragraph fixture
- **THEN** page, fragment, line, and style-span output reflects each property with stable source ranges

#### Scenario: Deferred content is encountered
- **WHEN** paragraph traversal encounters a deferred element
- **THEN** layout follows its declared preservation or rejection status without claiming semantic layout support

### Requirement: Semantic interaction authority
Caret stops, hit testing, selection, keyboard navigation, and composition anchors SHALL derive from semantic layout records and stable text positions rather than DOM ranges or element rectangles.

#### Scenario: Pointer selects a line position
- **WHEN** a pointer coordinate hits a painted paragraph line
- **THEN** semantic hit-test data resolves a stable paragraph text position independent of DOM node identity

### Requirement: Output is a non-authoritative consumer
The browser output layer SHALL safely construct and update native DOM from semantic layout records and SHALL NOT remeasure text, repaginate content, or publish canonical geometry.

#### Scenario: Page is repainted
- **WHEN** output replaces a paragraph fragment after a new layout revision
- **THEN** semantic positions and geometry remain those published by layout

### Requirement: Deterministic revision publication
Layout and interaction publication SHALL reject stale or mixed revisions and SHALL expose either one complete committed revision or the last complete revision.

#### Scenario: Stale layout completes late
- **WHEN** layout for an older model revision finishes after a newer revision has been requested
- **THEN** the older result is not published to output or interaction consumers

### Requirement: Change-scoped incremental layout
Layout SHALL consume the committed `ModelChange` dirty identities, created/deleted/moved and split/join effects, dependency keys, and impact class. It SHALL retain the previous complete layout, resume from a safe checkpoint before the first affected block, and reuse an unchanged suffix only after complete flow-state convergence is proven.

#### Scenario: One paragraph changes without repagination
- **WHEN** a text-local edit changes one paragraph and the new layout converges with the previous flow state
- **THEN** layout reuses unaffected paragraph, page, and display records outside the resume-to-convergence interval

#### Scenario: Reuse cannot be proven
- **WHEN** a dependency is missing, a position-sensitive feature is unsupported, or checkpoint state does not match exactly
- **THEN** the engine falls back to a clean full layout and publishes no speculative mixed result

### Requirement: Fingerprinted paragraph layout cache
Paragraph shaping and line-layout reuse SHALL require matching stable paragraph identity, canonical content fingerprint, resolved dependency fingerprint, available width, resource fingerprints, shaping configuration, and producer version. Model revision SHALL be provenance rather than an automatic cache miss.

#### Scenario: Unrelated paragraph changes
- **WHEN** another paragraph commits at a newer revision without changing a cached paragraph's inputs or dependency closure
- **THEN** the unchanged paragraph's shaping and line-layout records remain reusable

### Requirement: Stable page and display identity
Unchanged pages and display items SHALL retain stable identities across complete published revisions so output adapters can update only the changed page interval.

#### Scenario: Middle page is relaid
- **WHEN** an edit changes one middle page and pagination converges before the following page
- **THEN** preceding and following unchanged page/display records retain identity and are not rebuilt by adapters

### Requirement: Viewport-bounded output materialization
Output SHALL preserve page shells and complete semantic scroll geometry for every page while materializing detailed page content only for the viewport, bounded overscan, and any page containing the logical caret or selection.

#### Scenario: Long document scrolls
- **WHEN** the viewport moves through a long document
- **THEN** mounted detailed page content remains bounded by the visible range plus configured overscan while semantic hit testing and scroll geometry remain valid

#### Scenario: Selection page leaves the viewport
- **WHEN** scrolling moves a page containing the logical caret or selection outside normal overscan
- **THEN** interaction state remains semantic and resolvable without making mounted DOM canonical

### Requirement: Cancellable atomic global layout
Global layout work SHALL be revision-tagged, cancellable, cooperatively scheduled, and published atomically. Superseded jobs SHALL not publish. Worker execution SHALL remain deferred until resource and font transfer contracts are specified.

#### Scenario: Edit supersedes global layout
- **WHEN** a newer model revision commits while a global layout job is yielding
- **THEN** the older job is cancelled or discarded and only a complete result for the latest requested revision may publish

### Requirement: Incremental/full differential conformance
Every supported incremental-layout class SHALL be tested against a clean full layout of the same committed revision. Performance gates SHALL use structural work counters and identity/mount bounds rather than wall-clock thresholds.

#### Scenario: Incremental fixture completes
- **WHEN** text-local, paragraph-local, split/join, or flow-structural fixture edits run incrementally
- **THEN** semantic layout and display output equal clean full output while recorded work remains limited to the proven invalidation and convergence window
