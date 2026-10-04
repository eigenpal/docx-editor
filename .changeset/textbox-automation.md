---
'@docx-editor.dev/core': minor
---

The automation API exposes floating and inline shapes through `Body.shapes` and `Paragraph.shapes`, and a text box's `Shape.body` reads, searches, edits, and reviews its text like any body, so the owner story's tracked changes, `acceptAll`, and `rejectAll` no longer include text box changes. Saving writes edited text box text into the legacy VML copy too, and a paragraph that anchors a floating shape no longer reads an object character. Fixes #1070
