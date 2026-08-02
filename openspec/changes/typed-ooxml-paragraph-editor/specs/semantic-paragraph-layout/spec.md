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
Semantic layout SHALL resolve and represent the D8 run and paragraph property boundary, including authored whitespace, tabs, line hard breaks, and typed `w:br w:type="page"` page breaks; `w:spacing` before/after with collapsed adjacent spacing; `w:contextualSpacing` in body flow; line spacing under all three `w:lineRule` values; and all six `w:pBdr` edges. Border resolution SHALL place `top` and `bottom` as flow height, publish `between` in place of `bottom` where a paragraph continues into an identically bordered neighbour, and publish `left`, `right`, and `bar` outside the text column without reflowing it. Section-aware pagination SHALL honour per-section page size and margins, default/`nextPage` and `continuous` section breaks, `titlePage`, and per-section read-only header/footer furniture inheritance, including bounded allowlisted complex `PAGE`/`NUMPAGES` projection for page-furniture numbering. A `continuous` boundary SHALL share the preceding sheet only when the section's geometry and furniture are identical and the sheet is still open, and SHALL otherwise start a new sheet rather than publish a mixed one. Hyperlinks, body fields (including inert generic `w:fldSimple`), comments, tracked changes, images, content controls, header/footer editing, notes, paragraph-border authoring, `w:between` in table-cell and header/footer flow, border `w:shadow` and `themeColor`, `evenPage`/`oddPage`/`nextColumn` section semantics, and multi-column flow SHALL remain outside this layout acceptance.

#### Scenario: Accepted properties affect layout and spans
- **WHEN** accepted run properties, paragraph spacing/indents/tabs/numbering, pagination controls, `w:spacing` before/after, `w:contextualSpacing`, any `w:pBdr` edge, inline page breaks, or per-section geometry occur in the paragraph fixture
- **THEN** page, fragment, line, and style-span output reflects each property with stable source ranges

#### Scenario: Inline page break splits a paragraph across pages
- **WHEN** a paragraph contains `w:br w:type="page"` between inline content
- **THEN** layout places content before the break on the current page and content after the break on the next page while preserving one paragraph identity

#### Scenario: Paragraph spacing and borders affect fragment boxes
- **WHEN** adjacent paragraphs declare `w:spacing` before/after and/or a paragraph declares a `w:pBdr` box
- **THEN** fragment vertical placement applies collapsed before/after spacing, reserves top- and bottom-border extent as flow height, and publishes the side and bar rules beside the unchanged text column

#### Scenario: Consecutive identically bordered paragraphs form one box
- **WHEN** adjacent body paragraphs resolve the same border set and the set declares `w:between`
- **THEN** the group opens above its first member and closes below its last, interior boundaries carry the `between` rule rather than a bottom border, and a differing border set or an unbordered neighbour ends the group

#### Scenario: Continuous section shares the preceding sheet
- **WHEN** a section declares `w:type w:val="continuous"` and its geometry and furniture match the preceding section on a still-open sheet
- **THEN** its content continues down that sheet from the live flow cursor instead of starting a new page, and a differing geometry or a closed sheet starts a new page instead

#### Scenario: Multi-section document paginates per section
- **WHEN** a body story contains multiple sections ended by paragraph-level or body `w:sectPr` with distinct geometry and read-only header/footer references
- **THEN** layout paginates each section against its own page size/margins, starts non-continuous sections on a new page, and attaches the correct per-section furniture including `titlePage` inheritance

#### Scenario: Page-furniture PAGE and NUMPAGES project per sheet
- **WHEN** a read-only header or footer story contains allowlisted complex `PAGE`/`NUMPAGES` field instructions
- **THEN** layout projects the physical page index and document page count into that furniture without evaluating other field instructions or claiming body-field support

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
