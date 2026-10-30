---
'@docx-editor.dev/editor-api': patch
---

`Body.shapes` and `Paragraph.shapes` now list legacy VML shapes, so `Shape.body` reads, edits, and reviews the text of VML text boxes, whose tracked changes no longer belong to the main body. A text box or closed shape with no text story now answers an empty `body` that refuses writes, instead of failing the read.
