## ADDED Requirements

### Requirement: One-shot DOCX-to-PDF API

The package SHALL provide an asynchronous one-shot API that accepts untrusted DOCX bytes and
returns immutable PDF bytes with structured export metadata.

#### Scenario: Successful byte export

- **WHEN** a caller exports a supported DOCX byte array
- **THEN** the result contains a valid PDF byte array and the physical page count

#### Scenario: Invalid document

- **WHEN** Core rejects the DOCX package
- **THEN** the API returns or throws a typed error that preserves Core's bounded rejection reason

### Requirement: Reusable export session

The package SHALL support a reusable session over Core's export session without reparsing OOXML or
reconstructing document semantics. This requirement is deferred until the one-shot private first
slice is stable.

#### Scenario: Several PDF projections

- **WHEN** a caller exports several revision display modes from one session
- **THEN** each PDF uses the corresponding Core layout and the caller can dispose the session once

### Requirement: Shared physical layout authority

The PDF exporter SHALL use `ExportSemanticLayout` as its only source for page count, page size,
content geometry, line breaks, headers, footers, tables, drawings, and revision projection.

#### Scenario: Page geometry

- **WHEN** Core publishes pages with different authored sizes
- **THEN** each PDF page uses the matching width and height in points without repagination

#### Scenario: Exporter receives an unsupported record

- **WHEN** a semantic record cannot be represented in PDF
- **THEN** the exporter reports a bounded fidelity diagnostic instead of silently reparsing OOXML

### Requirement: Paint ordered page content

The exporter SHALL paint page backgrounds, borders, fills, text, equations, inline drawings,
anchored drawings, headers, footers, and overlays in a deterministic order derived from semantic
records. In the private first slice, page boxes, body/header/footer text spans, list markers,
published paragraph and cell shading fills, published paragraph borders, insert/delete revision
presentation, links, and named destinations are painted; other record kinds emit diagnostics and
remain deferred.

#### Scenario: Overlapping content

- **WHEN** a page contains normal flow and an anchored drawing with explicit stacking
- **THEN** the PDF preserves the semantic stacking order and clipping boundaries

#### Scenario: Table cell text in the first slice

- **WHEN** Core lays out text inside table cells
- **THEN** the first slice paints the cell text spans at semantic geometry and records a bounded
  `table` diagnostic for unsupported table structure and borders

#### Scenario: Published paragraph or cell shading

- **WHEN** Core publishes paragraph `shadingBox` geometry or cell shading with a usable box
- **THEN** the exporter paints a fill rectangle behind the text in document order

#### Scenario: Published solid paragraph borders

- **WHEN** Core publishes paragraph `borders` or a fallback `bottomBorder` with a usable edge box
  whose `val` is `single` or `thick`
- **THEN** the exporter paints each published edge box at the story origin, treats `auto` colour as
  black, and does not record `unsupported:paragraph-border`

#### Scenario: Approximated paragraph border variants

- **WHEN** Core publishes a dashed, dotted, double, or art paragraph border
- **THEN** the exporter paints a solid rule in the published edge box and records a bounded
  `paragraph-border` approximation diagnostic that names the authored `val` and side

#### Scenario: Grouped paragraph box without a duplicate closing edge

- **WHEN** a fragment publishes the closing edge in `borders` and also carries `bottomBorder`
- **THEN** the exporter paints that closing edge once

#### Scenario: Published paragraph borders inside nested hosts

- **WHEN** Core publishes paragraph borders inside a table cell, header, footer, or nested textbox
- **THEN** the exporter paints each edge at the host story origin plus the published box

#### Scenario: Published shading inside a textbox story

- **WHEN** Core publishes paragraph or table-cell shading inside a bounded textbox story
- **THEN** the exporter paints each fill once at the absolute textbox origin before the story text
  and stops descent at the nested textbox walk ceiling

#### Scenario: Foreground textbox shading over body text

- **WHEN** a page contains body text and a foreground (`behindDocument: false`) textbox with
  published shading
- **THEN** the exporter paints that textbox's fills and text after the body story so body glyphs do
  not cover the textbox shading

#### Scenario: Behind-document textbox under body text

- **WHEN** a page contains body text and a behind-document textbox with published shading
- **THEN** the exporter paints that textbox's fills and text before the body story so body glyphs
  cover the behind-document layer

#### Scenario: Light text without a painted fill

- **WHEN** painted text has insufficient contrast against the painted background because a
  published fill was omitted
- **THEN** the exporter records a bounded `unreadable-without-fill` diagnostic for that span

#### Scenario: All-markup insertion and deletion

- **WHEN** Core publishes insert and delete attributions on visible spans in `all-markup`
- **THEN** the exporter applies Core revision presentation so inserted and deleted text are not
  identical, or records a bounded diagnostic when that presentation cannot be encoded

#### Scenario: Unpainted review artifacts

- **WHEN** the export layout contains comments or ranged or point review artifacts
- **THEN** the exporter records a bounded diagnostic for each artifact that is not painted as a
  PDF annotation

### Requirement: Exact text placement

The exporter SHALL preserve Core's selected font face, shaped glyph sequence, glyph positions,
baseline, and span geometry without running an independent line-breaking or shaping pipeline. Exact
text placement is not complete in the private first slice.

#### Scenario: Complex script text

- **WHEN** Core lays out Arabic, Indic, CJK, combining marks, or bidirectional text
- **THEN** the PDF uses the same glyph sequence and positions inside the same line box

#### Scenario: Writer cannot encode Core shaping

- **WHEN** the PDF writer cannot encode Core's HarfBuzz glyph run for a painted span
- **THEN** best-effort export records a bounded approximation diagnostic and strict export refuses
  with a typed fidelity error

#### Scenario: First slice embeds admitted bytes but reshapes Unicode

- **WHEN** Core admits a matching font face, the PDF-layer embedding gate accepts its sfnt OS/2
  `fsType` and `faceIndex`, and the writer paints a text span with those bytes
- **THEN** the PDF embeds the exact admitted font program through PDFKit, records a bounded
  `shaped-glyph-run` approximation because PDFKit reshapes Unicode and does not encode Core glyph
  IDs or positions, and strict export refuses the document

#### Scenario: First slice falls back to built-in fonts

- **WHEN** no Core-admitted face matches a painted span's requested `(family, weight, style)`, or
  the PDF-layer embedding gate refuses the admitted face, and the span text is WinAnsi-representable
- **THEN** the writer uses a PDF built-in font, records a truthful `shaped-glyph-run` approximation,
  records `standard-font-substitution` when the built-in mapping is not exact, and strict export
  refuses the document

#### Scenario: Built-in fallback cannot encode span text

- **WHEN** a painted span would use a PDF built-in font and its text is not WinAnsi-representable
- **THEN** the writer omits the span, records a `standard-font-encoding` unsupported diagnostic with
  the page index, the selected PDF built-in font, and the requested family, and strict export refuses
  the document

#### Scenario: TTC or OTC collection container

- **WHEN** Core admits a TTC or OTC collection container with a valid `faceIndex`
- **THEN** the writer selects that collection face, checks the selected face OS/2 `fsType`,
  registers the selected PostScript name with PDFKit, and paints with the same face cmap

#### Scenario: Malformed or out-of-range collection face

- **WHEN** Core admits a collection container that is truncated, has an unsupported TTC version,
  exceeds the face-count cap, or whose `faceIndex` is out of range
- **THEN** the writer refuses embedding, records a `font-embedding-permission` unsupported
  diagnostic, falls back to a PDF built-in font for painting only when the span text is
  WinAnsi-representable, and strict export refuses the document

### Requirement: Embedded and subset fonts

The exporter SHALL embed the exact resolved font programs Core admits and SHALL subset them without
changing visual glyph identity, Unicode extraction, or positioning once strict text fidelity is
complete. The PDF encoder MAY remap source glyph identifiers to deterministic subset character
identifiers. In the private first slice, the writer registers exact admitted bytes through PDFKit
when the PDF-layer embedding gate accepts the face; subsetting and Unicode mapping follow
PDFKit/fontkit, and Core glyph positions remain unencoded.

#### Scenario: Packaged or caller font

- **WHEN** Core resolves a packaged or caller-provided face, the PDF-layer embedding gate accepts
  its sfnt OS/2 `fsType` and `faceIndex`, and the writer consumes its admitted bytes
- **THEN** the PDF embeds a subset of that exact face through PDFKit and maps painted Unicode
  through fontkit reshaping until Core glyph positions are encoded

#### Scenario: Embedded document font

- **WHEN** Core resolves an embedded DOCX font permitted for output, the PDF-layer embedding gate
  accepts its sfnt OS/2 `fsType` and `faceIndex`, and the writer consumes its admitted bytes
- **THEN** the PDF uses the same admitted bytes

#### Scenario: Forbidden face at Core admission

- **WHEN** Core marks a font source as `availability: 'forbidden'` or drops a document-embedded face
  before admission
- **THEN** the PDF writer never receives those bytes and does not embed the face

#### Scenario: Restricted, no-subsetting, or bitmap-only OS/2 fsType

- **WHEN** an admitted face's sfnt OS/2 `fsType` forbids embedding, forbids subsetting, or permits
  bitmap embedding only
- **THEN** the PDF writer refuses embedding, records a `font-embedding-permission` unsupported
  diagnostic, falls back to a PDF built-in font for painting only when the span text is
  WinAnsi-representable, and strict export refuses the document

#### Scenario: Embedded face missing cmap coverage

- **WHEN** the PDF-layer embedding gate accepts an admitted face and the span text contains a
  Unicode scalar that the selected face cmap does not cover, including Arabic, Indic, CJK, emoji, or
  a combining mark
- **THEN** the writer omits the span, does not paint `.notdef` glyphs, records a
  `font-cmap-coverage` unsupported diagnostic that identifies the missing cmap coverage, and strict
  export refuses the document. Variation selectors and ZWJ/ZWNJ do not fail coverage by themselves.

#### Scenario: Selected collection face

- **WHEN** Core admits a collection container with a valid `faceIndex`
- **THEN** the writer embeds that selected face through PDFKit using the derived PostScript
  selector, including a non-zero `faceIndex`, and cmap coverage uses the same face

#### Scenario: Nonzero faceIndex on a standalone sfnt

- **WHEN** Core admits standalone TTF or OTF bytes with a non-zero `faceIndex`
- **THEN** the writer refuses embedding, records a `font-embedding-permission` unsupported
  diagnostic, falls back to a PDF built-in font for painting only when the span text is
  WinAnsi-representable, and strict export refuses the document

#### Scenario: Admitted-face aliases share one byte resource

- **WHEN** Core admits the same resource identity for multiple request aliases
- **THEN** `exportPdf` preserves each alias while sharing one bounded byte copy per resource
  identity through PDF encoding

### Requirement: Validated image reuse

The exporter SHALL obtain image bytes only through the owning `ExportSession` capability and SHALL
preserve semantic crop, transform, clip, opacity, and accessibility metadata where PDF supports it.
Image embedding is deferred in the private first slice.

#### Scenario: Ready image

- **WHEN** a drawing has a ready validated image handle
- **THEN** the PDF embeds the validated bytes at the semantic geometry

#### Scenario: Missing or external image

- **WHEN** a drawing is missing, unrenderable, or external
- **THEN** the exporter performs no external fetch and records a nonfatal fidelity diagnostic

### Requirement: Hyperlinks and document navigation

The exporter SHALL emit link annotations only from sanitized semantic links and SHALL support
internal destinations when their targets resolve in the exported layout.

#### Scenario: Safe external link

- **WHEN** a span contains a sanitized HTTPS link
- **THEN** the PDF contains a link annotation over the span geometry

#### Scenario: Internal destination

- **WHEN** Core publishes destination geometry for a resolved bookmark or note target
- **THEN** the PDF contains a matching internal destination and link annotation

#### Scenario: Unsafe or unresolved link

- **WHEN** a semantic link has a null target
- **THEN** the PDF emits no actionable annotation

### Requirement: Metadata and deterministic bytes

The exporter SHALL map bounded document metadata into the PDF information dictionary and SHALL
provide a deterministic mode whose output bytes are stable for identical inputs and options.

#### Scenario: Deterministic export

- **WHEN** identical document bytes, resources, and deterministic options are exported twice
- **THEN** both PDF byte arrays are identical

### Requirement: Bounded untrusted-input handling

The exporter SHALL enforce limits for pages, objects, images, fonts, output bytes, recursion, and
execution time. It SHALL observe caller cancellation throughout generation.

#### Scenario: Resource limit

- **WHEN** an export exceeds a configured hard limit
- **THEN** generation stops with a typed resource error and releases session-owned resources

#### Scenario: Cancellation

- **WHEN** the caller aborts during layout, page planning, or PDF encoding
- **THEN** generation stops promptly and returns no partial successful result

#### Scenario: Cancellation during one-page span planning

- **WHEN** the caller aborts with a timer-based signal while the planner walks many spans on one page
- **THEN** generation stops during span planning without collecting every span visit first, and returns no partial successful result

#### Scenario: Cancellation during paragraph-order preparation

- **WHEN** the caller aborts with a timer-based signal while the planner prepares paragraph order on one page
- **THEN** generation stops during order preparation without building the complete order map in one turn, including when few unique paragraph ids repeat across many scanned lines on a cold cache, and returns no partial successful result

#### Scenario: Cancellation during warm paragraph-order cache replay

- **WHEN** the caller aborts while replaying a warm `everyStoryOrder` cache with many unique paragraph ids
- **THEN** generation stops during order preparation without replaying every cached id in one turn, and returns no partial successful result

#### Scenario: Cancellation during empty or skipped paint-host visits

- **WHEN** the caller aborts with a timer-based signal while the planner visits many empty or skipped paint hosts on one page
- **THEN** generation stops during host visits without waiting for a paint command, and returns no partial successful result

#### Scenario: Cancellation during fill traversal

- **WHEN** the caller aborts with a timer-based signal while the planner walks many published fills on one page
- **THEN** generation stops during fill traversal and returns no partial successful result

#### Scenario: Cancellation during paragraph-border traversal

- **WHEN** the caller aborts with a timer-based signal while the planner walks many published paragraph borders on one page
- **THEN** generation stops during border traversal and returns no partial successful result

#### Scenario: Cancellation during nested bordered-cell traversal

- **WHEN** the caller aborts with a timer-based signal while the planner walks a deeply nested bordered cell on one page
- **THEN** generation stops during border traversal without scanning the nested subtree before the first yield, and returns no partial successful result

#### Scenario: Cancellation during nested shaded-cell fill traversal

- **WHEN** the caller aborts with a timer-based signal while the planner walks a deeply nested shaded cell on one page
- **THEN** generation stops during fill traversal without scanning the nested subtree before the first yield, and returns no partial successful result

#### Scenario: Cancellation during named-destination planning

- **WHEN** the caller aborts with a timer-based signal while the planner walks many named destinations on one page
- **THEN** generation stops during destination planning and returns no partial successful result

#### Scenario: Cancellation during list-marker traversal

- **WHEN** the caller aborts with a timer-based signal while the planner walks many list markers on one page
- **THEN** generation stops during marker traversal and returns no partial successful result

#### Scenario: Cancellation during review-artifact diagnostics

- **WHEN** the caller aborts with a timer-based signal while the planner walks many review artifacts on one page
- **THEN** generation stops during review diagnostics and returns no partial successful result

#### Scenario: Cancellation during one-page unsupported diagnostic traversal

- **WHEN** the caller aborts with a timer-based signal while the planner walks a nested unsupported tree on one page
- **THEN** generation stops during unsupported diagnostic traversal without walking the whole page in one turn, and returns no partial successful result

### Requirement: Structured fidelity report

Every successful export SHALL include immutable diagnostics for omitted, approximated, substituted,
or unsupported content.

#### Scenario: Fully represented document

- **WHEN** every semantic record is represented exactly
- **THEN** the fidelity report states complete coverage and contains no diagnostics

#### Scenario: Best-effort approximation

- **WHEN** best-effort mode approximates a supported noncritical feature
- **THEN** the report identifies the feature, page, record, reason, and approximation
