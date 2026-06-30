## Why

The editor must display DOCX content with Microsoft Word-compatible page geometry and keep caret and selection overlays aligned with the painted document. The required behavior is grounded in ECMA-376 and observable regression tests.

## What Changes

- Render OOXML paragraphs, tables, sections, columns, footnotes, headers, footers, text boxes, and floating objects into CSS-pixel pages.
- Preserve document-position anchors in painted DOM so pointer, caret, and selection behavior remains accurate across virtualization and zoom.
- Give applications one stable DOM-facing rendering API.
- Keep React and Vue rendering behavior identical.

## Capabilities

### Pagination

Content follows OOXML page, margin, section, spacing, break, table, column, and drawing rules. Where OOXML leaves visual behavior unspecified, named regression tests define the expected Word-compatible result.

### Selection mapping

Painted DOM carries document-position ranges. Pointer placement, carets, and range highlights use those ranges within the correct body or header/footer region.

## Impact

The change affects core page rendering and the React and Vue adapters. Existing DOCX parsing and serialization vocabulary remains unchanged. Acceptance is based on package builds, focused rendering tests, and adapter parity.
