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
records. In the private first slice, only page boxes, body/header/footer text spans, list markers,
links, and named destinations are painted; other record kinds emit diagnostics and remain deferred.

#### Scenario: Overlapping content

- **WHEN** a page contains normal flow and an anchored drawing with explicit stacking
- **THEN** the PDF preserves the semantic stacking order and clipping boundaries

#### Scenario: Table cell text in the first slice

- **WHEN** Core lays out text inside table cells
- **THEN** the first slice paints the cell text spans at semantic geometry and records a bounded
  `table` diagnostic for unsupported table structure and decoration

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
  the page index and requested family, and strict export refuses the document

#### Scenario: TTC or OTC collection container

- **WHEN** Core admits a TTC or OTC collection container with any `faceIndex`
- **THEN** the writer refuses embedding because a verifiable collection face selector is
  unavailable, records a `font-embedding-permission` unsupported diagnostic, falls back to a PDF
  built-in font for painting only when the span text is WinAnsi-representable, and strict export
  refuses the document

#### Scenario: Nonzero TTC or OTC faceIndex

- **WHEN** Core admits a collection container with a non-zero `faceIndex`
- **THEN** the writer refuses embedding because a verifiable collection face selector is
  unavailable, records a `font-embedding-permission` unsupported diagnostic, falls back to a PDF
  built-in font for painting only when the span text is WinAnsi-representable, and strict export
  refuses the document

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

#### Scenario: Restricted or no-subsetting OS/2 fsType

- **WHEN** an admitted face's sfnt OS/2 `fsType` forbids embedding or forbids subsetting
- **THEN** the PDF writer refuses embedding, records a `font-embedding-permission` unsupported
  diagnostic, falls back to a PDF built-in font for painting only when the span text is
  WinAnsi-representable, and strict export refuses the document

#### Scenario: Nonzero TTC or OTC faceIndex

- **WHEN** Core admits a collection container with a non-zero `faceIndex`
- **THEN** the writer refuses embedding because a verifiable collection face selector is
  unavailable, records a `font-embedding-permission` unsupported diagnostic, falls back to a PDF
  built-in font for painting, and strict export refuses the document

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

- **WHEN** the caller aborts during layout or PDF encoding
- **THEN** generation stops promptly and returns no partial successful result

### Requirement: Structured fidelity report

Every successful export SHALL include immutable diagnostics for omitted, approximated, substituted,
or unsupported content.

#### Scenario: Fully represented document

- **WHEN** every semantic record is represented exactly
- **THEN** the fidelity report states complete coverage and contains no diagnostics

#### Scenario: Best-effort approximation

- **WHEN** best-effort mode approximates a supported noncritical feature
- **THEN** the report identifies the feature, page, record, reason, and approximation
