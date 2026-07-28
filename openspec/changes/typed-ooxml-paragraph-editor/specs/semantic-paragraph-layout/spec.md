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
