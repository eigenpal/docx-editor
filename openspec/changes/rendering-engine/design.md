## Context

A DOCX is parsed into OOXML-derived document data, edited through an off-screen editing host, and displayed as paged DOM. Correctness comes from ECMA-376 plus tests that record Microsoft Word behavior where the standard does not prescribe pixels.

## Goals

- Produce Word-faithful pages at the CSS reference resolution of 96 px/in.
- Keep page geometry deterministic for the same document, fonts, viewport, and zoom.
- Keep body and header/footer position spaces isolated.
- Preserve React and Vue behavior parity.
- Keep implementation vocabulary out of the supported package API.

## Decisions

### Units

OOXML lengths retain their standard meanings: 1440 twips per inch, 20 twips per point, and 914400 EMU per inch. Screen geometry uses 96 CSS pixels per inch before zoom.

### Text and page layout

Text wraps according to resolved OOXML font, size, indentation, tab, spacing, and drawing properties. Pages honor section dimensions, margins, columns, explicit breaks, keep rules, table row constraints, footnotes, and header/footer bands. The same input must produce the same page placement.

### Painted DOM contract

Painted elements expose `data-doc-from` and `data-doc-to` ranges. Body queries are scoped to body DOM; each header and footer is queried within its own DOM subtree. Virtualized pages may use already-computed geometry until their DOM is available.

### Supported API

Applications receive rendered documents, pages, CSS-pixel boxes, caret geometry, and selection rectangles.

## Risks and trade-offs

Font availability and browser glyph metrics can change wrapping. Behaviors not fixed by OOXML require regression tests against Word. Bundling the shared implementation into first-party adapters increases output size but keeps their rendering behavior aligned.
