---
'@eigenpal/docx-js-editor': patch
---

Fix layout for documents with mixed sections and complex tables. Fixes #319.

- Documents that mix portrait and landscape sections render with each section's own page size, margins, and columns instead of forcing every page to the body default.
- Paragraphs that follow `<w:lastRenderedPageBreak/>` (the marker Word writes when it lays out a doc) no longer collapse onto the previous page on first load. The marker survives save+reload at its original position.
- A section break immediately followed by a `pageBreakBefore` paragraph (e.g. an "Attachment" heading after a section change) no longer leaves a blank page between the body and the heading.
- Tables with auto-fit grids, zero-width grid columns, or sparse single-cell rows render with correct column widths instead of collapsing or stretching.
- Tables with vertically merged columns (`vMerge`) or explicit `gridSpan` no longer have continuation cells incorrectly expanded to span the full row.
- A section override of only `marginRight` or `marginBottom` is now honored; unset sides inherit from the prior section instead of resetting to the OOXML 1440 default.
- Paragraph spacing inside table cells is applied during measurement and rendering.
- An oversized paragraph or image (taller than the page content area, possibly after a continuous section break to a smaller page size) is placed with overflow instead of hanging the pageComposer.
