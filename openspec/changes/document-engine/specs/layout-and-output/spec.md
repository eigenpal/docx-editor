## ADDED Requirements

### Requirement: Resolved caches retain revision provenance
Style, numbering, field, font, image, and layout inputs SHALL be derived from
authored state into caches recording model revision as provenance plus dependency
and input fingerprints. Cross-revision reuse MUST be allowed when those
fingerprints are unchanged.
Serialization MUST NOT consume resolved values as authored properties.

#### Scenario: Cache revision is stale
- **WHEN** a dependency changes after a resolved entry was computed
- **THEN** the entry MUST be invalidated or recomputed before measurement and MUST NOT mutate authored state

### Requirement: Deterministic browser-free shaping
Text shaping MUST use explicit font bytes and runtime ports to resolve fallback,
clusters, bidi, ligatures, kerning, advances, and vertical metrics. It MUST NOT
use canvas or a browser font stack as the layout oracle.

#### Scenario: Equivalent runtime inputs
- **WHEN** browser, worker, and server receive the same authored model, fonts, ports, and configuration
- **THEN** shaped runs, line breaks, and measured geometry MUST be equivalent

### Requirement: Layout supports document structures
Layout SHALL handle sections, columns, paragraphs, lists, tables and row
splitting, content controls, inline and floating images, headers, footers, notes,
comments, tracked changes, fields, page numbers, internal references, and
relationship-backed resources.

#### Scenario: Table continues across pages
- **WHEN** a table row or vertically merged cell crosses a page boundary
- **THEN** pagination MUST emit deterministic fragments, repeated headers where authored, clipping, and closing borders

### Requirement: Invalidation follows dependency closure
Layout invalidation MUST expand directly dirty identities through style,
numbering, section, story, font, image, table, field, note, and annotation
dependencies. It SHALL reuse only cache entries proven unaffected.

#### Scenario: Header dependency changes
- **WHEN** a header used by multiple section pages changes height
- **THEN** every dependent page flow MUST be included in invalidation even if its body blocks did not change

### Requirement: Pagination restarts until convergence
Pagination SHALL restart at the earliest affected flow position and continue
downstream until page state converges with valid cached state. Page-dependent
resolution SHALL rerun affected pagination when resolved content changes
geometry. The result MUST be exactly one of: `converged`;
`cycleResolved`, after deterministic tie-break and complete revalidation; or
`nonConverged`, containing only a diagnostic stable prefix that MUST NOT be
saved, exported, or represented as complete output.

#### Scenario: Early paragraph gains a line
- **WHEN** an edit adds one line near the beginning of a long document
- **THEN** pagination MUST continue through shifted pages until page boundaries converge and MUST NOT stop at the edited block

### Requirement: Display items carry final geometry and anchors
The immutable display list SHALL contain positioned glyphs, shapes, images,
links, clipping, transforms, semantic roles, and internal document anchors for
selectable content and navigation. Output backends MUST NOT rederive geometry or
use ProseMirror offsets.

#### Scenario: Hit test resolves through an item
- **WHEN** a pointer hits a glyph display item
- **THEN** hit testing MUST return its document anchor and affinity for selection resolution

### Requirement: Output backends share one display list
The engine MUST route DOM rendering, print, accessibility projection, hit
testing, and PDF export through the same resolved display list. Browser, worker, and server output
MUST preserve equivalent page geometry and navigation targets.

#### Scenario: DOM and PDF render the same pages
- **WHEN** one layout result is sent to DOM and PDF backends
- **THEN** both MUST use identical page boxes, glyph positions, image boxes, links, and clipping

### Requirement: PDF is emitted natively over the IR
PDF export MUST run without a browser and SHALL embed or subset fonts, position
glyphs from shaped advances, emit images and transforms, apply clipping, and
create external and internal link annotations from display items.

#### Scenario: Server exports PDF
- **WHEN** a server exports a document containing rotated images and internal links
- **THEN** native PDF output MUST preserve their geometry and navigation without launching a browser

### Requirement: Missing runtime resources fail deterministically
Font and image resolution SHALL use explicit ports and substitution policy.
Missing, forbidden, malformed, or over-limit resources MUST yield a typed
diagnostic or declared fallback rendering and MUST NOT trigger an implicit external
fetch.

#### Scenario: Remote font is referenced
- **WHEN** the authored package references an external font
- **THEN** layout MUST use the declared safe fallback or fail by policy and MUST NOT fetch the font automatically

### Requirement: ShapingEnvironment is complete and hashable
`ShapingEnvironment` MUST include font bytes/hash, face index, variation axes,
shaping library/version, Unicode data version and normalization policy, script,
language, direction, OpenType features, fallback order, fixed-point scale, and
rounding mode. Shaped coordinates and advances MUST use fixed-point integers and
a declared rounding rule.

#### Scenario: Shaping runs in three runtimes
- **WHEN** all `ShapingEnvironment` fields and input text match
- **THEN** glyph IDs, clusters, advances, offsets, fallback choices, and bidi levels MUST compare exactly

### Requirement: Cache provenance includes non-model epochs
Every resolved/measurement cache entry MUST record model revision, transitive
dependency fingerprint, resource epoch, configuration epoch, extension-set
fingerprint, shaping-environment hash, and producer version. Reuse MUST prove
dependency/input fingerprints and producer version unchanged against immutable
operation-scoped resource, configuration, extension, and shaping snapshots;
model revision is provenance, not an equality condition. Any relevant epoch
change during an operation MUST abort/restart affected derived work.

#### Scenario: Font becomes available asynchronously
- **WHEN** the font resource epoch changes without a model edit
- **THEN** every dependent shaping and layout entry MUST invalidate while unrelated entries remain reusable

### Requirement: Pagination convergence is canonical and bounded
The convergence fingerprint MUST contain page/column boundaries, flow IDs,
break causes, note assignments, header/footer variants, resolved field values,
numbering state, and fixed-point geometry at the reuse frontier. The frontier
MUST advance only after consecutive matching fingerprints. A finite configured
pass limit and non-disableable ceiling, deterministic repeated-state tie-break,
stable-prefix fallback, and diagnostic trace MUST be defined.
Cycle resolution MUST revalidate the complete document before returning
`cycleResolved`; pass-limit failure MUST return `nonConverged` and its stable
prefix MUST remain diagnostic-only.

#### Scenario: Page-dependent field oscillates
- **WHEN** a field width alternates between two pagination states
- **THEN** the engine MUST apply the declared tie-break or return non-convergence with both fingerprints and dependency trace

### Requirement: Justification and text fit use explicit advances
Layout MUST represent justification, character compression/expansion, distributed alignment, and
text-fit MUST be represented as explicit fixed-point per-line or per-cluster
advance adjustments in measured output and display items. Backends MUST NOT
delegate them to CSS or PDF text layout.
The algorithm MUST freeze eligible opportunities, exclusions, visual-order
allocation after bidi resolution, signed quotient/remainder distribution with
the remainder assigned one fixed-point unit at a time in visual order, maximum
compression/expansion per opportunity, and text-fit minimum/maximum scale.

#### Scenario: Justified line renders in DOM and PDF
- **WHEN** a line requires distributed extra width
- **THEN** DOM and PDF MUST consume the same adjusted cluster advances and end at the same fixed-point line boundary

### Requirement: Semantic tree and clusters preserve accessibility
Output MUST include a semantic tree with logical reading order, language, roles,
headings, lists, tables, alt text, references, and artifacts. Glyph items MUST
map logical Unicode ranges through bidi and cluster maps to visual glyphs.
Accessible DOM and tagged PDF MUST preserve this tree and use `ActualText` when
visual glyphs do not encode logical text.
Every semantic node and display item MUST have a stable operation-local ID and
referentially valid ownership/logical-range links. Cluster maps MUST define
caret positions within ligatures at grapheme boundaries and deterministic
pointer affinity. Artifacts, non-selectable decorations, clipped-away items,
and pointer-transparent items MUST be excluded from hit eligibility by explicit
flags; all hit results MUST reference a valid semantic node, display item, and
anchor.

#### Scenario: Mixed-direction ligature is extracted
- **WHEN** shaped text contains bidi reordering and a multi-character ligature
- **THEN** selection, keyboard navigation, DOM accessibility, and PDF extraction MUST return the same logical Unicode sequence

### Requirement: Hit testing respects transforms clipping and z-order
Hit testing MUST traverse reverse paint z-order, intersect accumulated clips,
invert transforms, reject non-invertible transforms, and resolve a hit through
the cluster map and anchor affinity.

#### Scenario: Rotated clipped image overlays text
- **WHEN** a pointer lies inside the text box but under the visible transformed image
- **THEN** hit testing MUST select the topmost visible eligible item after transform and clip evaluation

### Requirement: Layout geometry supplies interaction prerequisites only
Layout MUST emit semantic position indexes, caret rectangles, selection rectangles,
and client-space hit targets as the sole geometry authority for visible interaction.
Direct page interaction, interaction-frame publication, and adapter overlay composition
MUST be owned by `interactive-paginated-editing`; this layout specification retains
its independent completion gate.

#### Scenario: Adapter receives a pointer coordinate
- **WHEN** a public adapter forwards host-space input through the editor facade
- **THEN** hit results and overlay geometry MUST come from layout-derived interaction data, not adapter or ProseMirror DOM measurement
