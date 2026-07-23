## ADDED Requirements

### Requirement: Comprehensive fixture is a frozen integration corpus
The engine MUST treat the source bytes, package-member inventory, relationship graph,
content types, and named feature regions of
`comprehensive-word-element-test.docx` as versioned
conformance inputs. Focused fixtures SHALL remain the diagnostic authority for each
feature.

#### Scenario: No-op package reopen
- **WHEN** the comprehensive fixture is parsed and saved without an authored edit
- **THEN** every package member, empty relationship part, unused content-type default, unknown extension, and safe malformed source construct is preserved to the declared byte-equivalence metric with zero external requests

#### Scenario: Fixture claim differs from encoded OOXML
- **WHEN** fixture prose claims a feature such as threaded comments or tracked revisions that is not structurally encoded
- **THEN** conformance records the actual OOXML and does not fabricate the claimed semantic structure

### Requirement: Paragraph and run formatting renders from authored resolution
The engine SHALL render fixture text with preserved whitespace, Unicode, bidi,
language, font, size, color, bold, italic, underline, strike, double-strike,
superscript, subscript, caps, small caps, highlight, shading, alignment, indentation,
spacing, tabs, breaks, symbols, and no-break behavior. Resolved values MUST remain
derived and MUST NOT overwrite authored properties.

#### Scenario: Direct formatting overrides style inheritance
- **WHEN** a run or paragraph contains direct formatting and inherited style values
- **THEN** layout uses the deterministic cascade while save retains the original authored distinction

#### Scenario: Unsupported font is unavailable
- **WHEN** an authored font cannot be resolved from embedded or explicitly supplied safe font bytes
- **THEN** layout uses the declared deterministic fallback or returns a typed missing-resource result without consulting the browser font stack as an oracle

### Requirement: Styles and numbering resolve deterministically
The engine SHALL model document defaults, style inheritance, paragraph and character
styles, table styles, abstract numbering, levels, overrides, restarts, label text,
and indentation needed by the fixture. Duplicate or missing style references MUST
resolve by a documented deterministic policy while preserving source XML.

#### Scenario: Duplicate heading style IDs are encountered
- **WHEN** the fixture's duplicate Heading style IDs are resolved
- **THEN** the selected display definition follows the reviewed precedence rule and every duplicate definition remains available for lossless reopen

#### Scenario: Multilevel list is rendered
- **WHEN** a paragraph references a numbering definition and level
- **THEN** layout emits the correct label, indentation, restart behavior, semantic-list structure, and anchored text geometry

### Requirement: Tables render complete authored structure
The engine SHALL render table grids, widths, rows, cells, nested block flow, grid
spans, vertical merges, borders, margins, shading, repeated headers, row splitting,
floating positioning, and nested tables represented in the fixture.

#### Scenario: Vertically merged table crosses a page
- **WHEN** a table containing a vertical merge paginates
- **THEN** display fragments preserve merged geometry, repeated headers, clipping, and closing borders without duplicate cell content

#### Scenario: Three-level nested table is rendered
- **WHEN** the fixture's nested table is laid out
- **THEN** each nested table participates in cell flow and remains anchored to its canonical table, row, and cell identities

### Requirement: Structured document controls render without execution
The engine SHALL structurally model and render block, inline, and table-cell SDTs,
including text, rich-text, checkbox, dropdown, combo-box, date, and TOC wrappers.
Locks, IDs, aliases, tags, list items, date formats, placeholder state, unknown
properties, and cached content MUST remain authored.

#### Scenario: Checkbox control is displayed
- **WHEN** a checked or unchecked fixture checkbox is rendered
- **THEN** output reflects the authored state and glyph without executing external logic or losing `w14` properties

#### Scenario: Unknown SDT property is encountered
- **WHEN** an SDT contains an unowned property
- **THEN** the property remains in an ownership-scoped capsule and does not prevent declared read-only rendering

### Requirement: Sections, columns, and related stories paginate together
The engine SHALL model section boundaries, page size, orientation, margins, columns,
column gaps and separators, section-break types, header/footer references, page and
column breaks, and related header/footer stories. Footnotes and endnotes SHALL retain
their references, separators, numbering, and placement semantics.

#### Scenario: Portrait section changes to landscape
- **WHEN** pagination reaches the fixture's landscape section
- **THEN** the next page uses the authored geometry and later pages return to the declared portrait geometry

#### Scenario: Two-column section contains a column break
- **WHEN** flow reaches the explicit column break
- **THEN** subsequent content starts in the next column and pagination fingerprints record the break cause

#### Scenario: Footer contains PAGE and NUMPAGES fields
- **WHEN** page-dependent fields converge
- **THEN** the footer display uses resolved values while retaining the authored field instructions separately

### Requirement: Embedded drawings and images render safely
The engine SHALL model relationship-backed embedded images, inline and anchored
drawing geometry, transforms, crop, wrap, positioning, alt text, and reuse of media
parts. Rendering MUST NOT assume DrawingML nonvisual IDs are globally unique.

#### Scenario: Floating image wraps text
- **WHEN** the anchored fixture image is laid out
- **THEN** display geometry honors margin-relative position, square wrapping, wrap distances, extent, transform, and alt text using only embedded media

#### Scenario: Multiple drawings reuse one image
- **WHEN** several drawing records reference one embedded media part
- **THEN** the media resource may be cached while every drawing retains independent authored geometry and identity

### Requirement: Links, bookmarks, fields, and navigation remain distinct
The engine SHALL model sanitized runtime hyperlinks separately from authored raw
targets, internal bookmark navigation, field instructions separately from resolved
results, and TOC structure without executing arbitrary field code.

#### Scenario: External hyperlink is activated
- **WHEN** a user explicitly activates an allowed external hyperlink
- **THEN** the sanitized runtime URL is used and the authored raw target remains available only for escaped OOXML serialization

#### Scenario: Malformed simple field is rendered
- **WHEN** a simple field contains the fixture's malformed instruction
- **THEN** it remains inert, displays only declared cached content if present, and is preserved without execution

### Requirement: Comments and revision structures render from encoded semantics
The engine SHALL model comment ranges, references, metadata, and independently
encoded threads. Tracked insertions, deletions, moves, and property changes SHALL be
modeled only when corresponding OOXML exists.

#### Scenario: Nested comment ranges lack thread metadata
- **WHEN** the fixture's nested comment ranges are parsed
- **THEN** output represents independent comments and does not infer a reply relationship from text or nesting

### Requirement: Settings and package properties remain authored resources
The engine MUST retain document settings, compatibility flags,
core/extended/custom properties, font-table records, content types, and
relationships as addressable package state, and they MUST influence rendering only
through declared dependencies.

#### Scenario: Fixture has no theme part
- **WHEN** the fixture is opened and saved
- **THEN** the engine does not invent a theme relationship or theme part

### Requirement: One display list drives browser and server output
DOM, hit testing, accessibility, print, and PDF SHALL consume the same positioned,
anchored display list. Equivalent model, fonts, runtime ports, and configuration MUST
produce equivalent pagination and anchoring in browser, worker, and server runtimes.

#### Scenario: React and Vue render the fixture
- **WHEN** both adapters open the same comprehensive fixture with identical resources and configuration
- **THEN** their pagination fingerprint, semantic tree, display-item fingerprint, and page count match
