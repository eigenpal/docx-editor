---
'@docx-editor.dev/core': patch
---

Fixed "Add space before/after paragraph" leaving the page unchanged, along with the line-spacing tick, the alignment button and Increase Indent reading a paragraph's document defaults instead of its own formatting. Paragraph formatting controls now answer for an open header, footer or note instead of reading the body, structural edits act on the cells a rectangle selects rather than everything between its corners, and a font pick, an underline toggle and a list conversion keep the settings they do not name. Fixes #360
