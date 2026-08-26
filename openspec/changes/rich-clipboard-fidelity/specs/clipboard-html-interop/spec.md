## ADDED Requirements

### Requirement: Outbound HTML preserves resolved formatting for external editors

The interop HTML SHALL derive structure from the canonical tree and
formatting from resolved values. Heading-styled paragraphs SHALL emit
`<h1>`–`<h6>`; list paragraphs SHALL emit nested `<ol>`/`<ul>`/`<li>` with a
matching `list-style-type`; tables SHALL emit `<table>`/`<tr>`/`<td>` with
inline border, background, width, and vertical-alignment CSS; runs SHALL
carry resolved font family, size, weight, style, color, background,
decoration, and vertical alignment as inline CSS; hyperlinks SHALL emit
`<a href>` with the target passed through the href sanitizer; images SHALL
emit `data:` URIs under a per-image and total budget and SHALL be omitted
above it. Constructs without an HTML mapping SHALL be omitted from the
interop HTML while staying lossless in the fragment lane. The writer SHALL
escape every interpolated value and SHALL NOT use DOM insertion sinks.

#### Scenario: Formatted content keeps its shape in external markup

- **WHEN** a selection with a heading, a numbered list, a table, and a
  hyperlink is copied
- **THEN** the `text/html` flavour contains a heading element, a real ordered
  list, a table with inline cell CSS, and a sanitized anchor

### Requirement: Inbound external HTML projects through a bounded parse

Pasting external `text/html` SHALL parse it into an inert document with a
size cap before parse and node-count and depth caps during the walk, and
SHALL project it into tree ops without attaching parsed nodes to the live
document. The projection SHALL map common word-processor CSS to OOXML
properties (alignment to `w:jc`, line height to `w:spacing`, margins to
`w:ind` and `w:spacing`, list markup to fresh numbering definitions, cell CSS
to cell properties) and SHALL detect Word's `mso-list` paragraph convention
(list id, level, and marker span) as list markup. Every href SHALL pass the
href sanitizer; `<img>` SHALL be accepted only with a `data:` URI, and
external image sources SHALL be dropped without any fetch. Script, style,
and event-handler content SHALL be ignored.

#### Scenario: External word-processor HTML keeps formatting

- **WHEN** HTML shaped like a word-processor clipboard payload (headings,
  bold spans, a nested list, a shaded table cell) is pasted
- **THEN** the inserted paragraphs carry the mapped paragraph and run
  properties, the list references a fresh numbering definition, and the cell
  shading is preserved

#### Scenario: Word desktop list markup maps to numbering

- **WHEN** pasted HTML carries `MsoListParagraph` paragraphs with `mso-list`
  level and list-id declarations instead of semantic list elements
- **THEN** the inserted paragraphs reference a fresh numbering definition at
  the declared levels and the literal marker span is not inserted as text

#### Scenario: Hostile payload stays inert

- **WHEN** pasted HTML contains script tags, event-handler attributes, a
  `javascript:` href, and an external image source
- **THEN** no script executes, no network request is made, the href is
  dropped as inert, and the image is omitted
