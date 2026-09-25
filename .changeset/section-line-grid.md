---
'@docx-editor.dev/core': patch
---

Paragraph lines in a section with a document line grid now take whole grid lines, so these documents keep their line spacing and page count. Paragraphs that turn off grid snapping, paragraphs with exact or at-least line spacing, and table cells without the table line-grid compatibility option keep their own line height.
