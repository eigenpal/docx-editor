---
'@docx-editor.dev/react': patch
---

Paint document text with the same font fallback the measurer uses, so a document declaring an unavailable font (like Aptos) keeps its caret, selection, and tracked-change marks aligned with the glyphs. The font picker now also lists faces the document reaches through theme references.
