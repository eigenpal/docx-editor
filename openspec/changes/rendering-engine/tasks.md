## Verification checklist

- [x] Convert OOXML lengths to CSS pixels using the documented standard ratios.
- [x] Wrap text with resolved fonts, tabs, indentation, spacing, and floating-object exclusion areas.
- [x] Honor section page size, margins, columns, and start behavior without phantom pages.
- [x] Honor explicit page breaks, keep behavior, widow/orphan behavior, and paragraph spacing.
- [x] Split tables according to row constraints, repeated headers, and vertical merges.
- [x] Place footnotes, headers, footers, text boxes, and floating drawings without corrupting body flow.
- [x] Stamp painted DOM with document-position ranges and scope body versus header/footer queries.
- [x] Keep caret and selection rectangles correct across lines, pages, scrolling, virtualization, and zoom.
- [x] Keep one active editing region and preserve body/header/footer focus hand-off.
- [ ] Verify the stable DOM-facing package API with real DOCX fixtures.
- [ ] Build the core, React, and Vue packages and check emitted JavaScript and declarations.
- [ ] Run type checking and focused rendering/selection tests.
