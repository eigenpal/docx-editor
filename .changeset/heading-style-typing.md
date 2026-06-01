---
'@eigenpal/docx-editor-core': patch
---

Fix paragraph styles on empty paragraphs and the style that follows a heading on Enter. Applying a heading style to an empty paragraph and then typing now produces styled text instead of plain body text, and the style picker shows the right state. Pressing Enter at the end of a heading now starts the next paragraph in the style's follow-on style (body text) instead of another heading.
