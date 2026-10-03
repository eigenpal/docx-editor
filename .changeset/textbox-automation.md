---
'@docx-editor.dev/core': minor
---

The automation API exposes floating shapes through `Body.shapes` and `Paragraph.shapes`, and a text box's `Shape.body` reads, searches, and edits its text like any body. Saving writes edited text box text into the legacy VML copy too, and a paragraph that anchors a floating shape no longer reads an object character. Fixes #1070
