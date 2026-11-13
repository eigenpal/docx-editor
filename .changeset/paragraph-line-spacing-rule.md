---
'@docx-editor.dev/editor-api': minor
---

Read and set how line spacing is measured through `Paragraph.lineSpacingRule` in the editing API, and keep a line rule from the paragraph's style when you set `lineSpacing`. `Paragraph.lineSpacing` now reads the spacing in force, including spacing from the style, instead of `null`. Fixes #1957
