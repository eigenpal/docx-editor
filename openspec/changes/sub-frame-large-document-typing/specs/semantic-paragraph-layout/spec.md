## MODIFIED Requirements

### Requirement: Semantic interaction authority

Caret stops, hit testing, selection, keyboard navigation, and composition anchors SHALL derive from complete semantic layout records and stable text positions rather than DOM ranges or element rectangles. An eligible provisional caret MAY derive from a private source-addressable provisional paragraph record for the latest committed model revision. Pointer resolution, cross-paragraph navigation, review anchors, object geometry, and structural commands SHALL require complete latest-revision layout.

#### Scenario: Pointer selects a line position

- **WHEN** a pointer coordinate hits a painted paragraph line and complete latest-revision layout is available
- **THEN** semantic hit-test data resolves a stable paragraph text position independent of DOM node identity

#### Scenario: Caret follows provisional insertion

- **WHEN** a committed insertion has an accepted provisional paragraph record with exact source ranges and geometry proof
- **THEN** the caret can use that record within its paragraph without making provisional geometry available to other interaction consumers

#### Scenario: Geometry operation arrives during provisional display

- **WHEN** pointer, vertical navigation, review, object, table, or automation geometry is requested while complete layout is stale
- **THEN** the editor settles complete latest-revision layout or returns a typed stale or unavailable result

### Requirement: Output is a non-authoritative consumer

The browser output layer SHALL safely construct and update native DOM from complete semantic layout records or private provisional paragraph records produced by the layout lane. It SHALL NOT remeasure text, repaginate content, publish canonical geometry, or expose provisional geometry as a complete `SemanticLayout`.

#### Scenario: Page is repainted

- **WHEN** output replaces a paragraph fragment after a new complete layout revision
- **THEN** semantic positions and geometry remain those published by complete layout

#### Scenario: Paragraph presents provisionally

- **WHEN** output receives an eligible provisional paragraph record for committed text on an existing materialized page
- **THEN** it patches only that owned paragraph and retains last-complete page geometry

### Requirement: Deterministic revision publication

Complete layout and complete interaction publication SHALL reject stale or mixed revisions and SHALL expose either one complete committed revision or the last complete revision. A private provisional paragraph display MAY present committed text while complete layout remains at the preceding revision, but it SHALL NOT publish a partial `SemanticLayout` or become authoritative outside its proved paragraph-local caret.

#### Scenario: Stale layout completes late

- **WHEN** layout for an older model revision finishes after a newer revision has been requested
- **THEN** the older result is not published to output or interaction consumers

#### Scenario: Complete layout trails committed text

- **WHEN** eligible committed text is visible through a provisional paragraph record
- **THEN** complete layout consumers retain the last complete revision until one complete latest-revision result publishes atomically

### Requirement: Change-scoped incremental layout

Complete layout SHALL consume the committed `ModelChange` dirty identities, created/deleted/moved and split/join effects, dependency keys, and impact class. It SHALL retain the previous complete layout, resume from a safe checkpoint before the first affected block, and reuse an unchanged suffix only after complete flow-state convergence is proven. A separate private provisional paragraph computation MAY run after commit, but it SHALL neither claim complete convergence nor publish a mixed layout.

#### Scenario: One paragraph changes without repagination

- **WHEN** a text-local edit changes one paragraph and the new complete layout converges with the previous flow state
- **THEN** complete layout reuses unaffected paragraph, page, and display records outside the resume-to-convergence interval

#### Scenario: Reuse cannot be proven

- **WHEN** a dependency is missing, a position-sensitive feature is unsupported, or checkpoint state does not match exactly
- **THEN** the engine falls back to a clean full layout and publishes no speculative mixed result

#### Scenario: Local geometry remains equivalent

- **WHEN** committed text reshapes locally and proves unchanged page ownership, fragments, line breaks, vertical metrics, and flow extent
- **THEN** a private provisional paragraph record can present before complete convergence without entering the complete layout graph

### Requirement: Viewport-bounded output materialization

Output SHALL preserve page shells and complete semantic scroll geometry for every complete-layout page while materializing detailed page content only for the viewport, bounded overscan, and any page containing the logical caret or selection. Provisional and settled reconciliation SHALL preserve unchanged shells and detailed materialized-page DOM by identity.

#### Scenario: Long document scrolls

- **WHEN** the viewport moves through a long document
- **THEN** mounted detailed page content remains bounded by the visible range plus configured overscan while semantic hit testing and scroll geometry remain valid

#### Scenario: Selection page leaves the viewport

- **WHEN** scrolling moves a page containing the logical caret or selection outside normal overscan
- **THEN** interaction state remains semantic and resolvable without making mounted DOM canonical

#### Scenario: Middle page settles without repagination

- **WHEN** an edit changes one materialized page and complete layout reuses every later page
- **THEN** output reconciles the changed page interval without rebuilding unrelated materialized pages

### Requirement: Cancellable atomic global layout

Global layout work SHALL capture an immutable package snapshot, model revision, scope, and resource fingerprints. It SHALL be cancellable, cooperatively scheduled, and published atomically. No continuation MAY read a later mutable session. Superseded jobs SHALL not publish. A private provisional paragraph record MAY present committed text before completion, but only a complete latest-revision layout MAY publish globally. Worker execution SHALL remain deferred until resource and font transfer contracts are specified.

#### Scenario: Edit supersedes global layout

- **WHEN** a newer model revision commits while a global layout job is yielding
- **THEN** the older job is cancelled or discarded and only a complete result for the latest requested revision may publish

#### Scenario: Input arrives during settle

- **WHEN** browser input is pending while cooperative complete layout has remaining phases
- **THEN** deadline-aware iteration returns to the browser event loop within its configured slice budget and resumes or is superseded without publishing partial state

#### Scenario: Input stops after provisional presentation

- **WHEN** no newer edit supersedes the pending model revision
- **THEN** cooperative layout completes, publishes one complete layout, and removes provisional state atomically

#### Scenario: Job is cancelled

- **WHEN** input, detach, reload, font change, display-mode change, or width change cancels a layout job
- **THEN** private accumulators and scheduled work are released, and no stale callback or unfingerprinted cache write affects later layout

### Requirement: Incremental/full differential conformance

Every supported complete incremental-layout class SHALL be tested against a clean full layout of the same committed revision. Settled performance gates SHALL use structural work counters and identity/mount bounds rather than hardware-dependent wall-clock thresholds. Provisional presentation SHALL have separate exact-record, input-correctness, and reference-profile latency gates.

#### Scenario: Incremental fixture completes

- **WHEN** text-local, paragraph-local, split/join, or flow-structural fixture edits run incrementally
- **THEN** complete semantic layout and display output equal clean full output while recorded work remains limited to the proven invalidation and convergence window

#### Scenario: Provisional fixture settles

- **WHEN** an eligible paragraph presents provisionally and later settles
- **THEN** its provisional source ranges, styles, glyph advances, and caret match the corresponding clean records, and the final complete layout equals clean full layout

#### Scenario: Shared runner measures timing

- **WHEN** browser timing runs outside the maintained reference profile
- **THEN** timing remains informational while structural, identity, mount, and correctness gates remain enforced

## ADDED Requirements

### Requirement: Settled layout change evidence

The layout lane SHALL own an immutable internal revision containing model revision, persistent page directory, persistent checkpoint directory, `LayoutChangeSet`, and lazy public `SemanticLayout` projection. Output SHALL receive read-only page accessors plus change evidence. The editor SHALL retain only an opaque handle and public projection access. Public `SemanticLayout.pages` SHALL remain a stable frozen array projection, but core typing paths SHALL NOT materialize or scan it.

#### Scenario: Reused page keeps its dependencies

- **WHEN** a page and every declared presentation dependency retain identity after convergence
- **THEN** settled paint reuses that page shell, detailed DOM when materialized, and derived presentation-index entries

#### Scenario: Drawing dependency changes

- **WHEN** a drawing resource or placement dependency changes on a reused page
- **THEN** layout change evidence marks every affected materialized occurrence for reconciliation

#### Scenario: Middle edit converges

- **WHEN** a text-local edit changes a bounded middle interval and flow state converges
- **THEN** settle performs changed-interval plus logarithmic directory work without copying the complete page array or checkpoint tail

#### Scenario: Public pages are read

- **WHEN** a consumer reads `SemanticLayout.pages` repeatedly from one complete layout
- **THEN** it receives the same frozen array projection while internal layout and output use the authoritative page directory

#### Scenario: Page shells preserve scroll geometry

- **WHEN** output creates materialized and unmaterialized page shells from an internal layout revision
- **THEN** shells remain in normal document flow with explicit dimensions while semantic cumulative offsets come from the page directory
