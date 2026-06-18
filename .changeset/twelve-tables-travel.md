---
'@eigenpal/docx-editor-core': minor
---

Newly inserted tables now adopt the document's default table style. When a document declares a default table style (settings `w:defaultTableStyle`, otherwise the table style marked default), inserting a table from the toolbar or via the agent API gives it that style's borders, shading, cell margins, and header/banding instead of a plain black grid. Documents without a default table style keep the previous thin black border.
