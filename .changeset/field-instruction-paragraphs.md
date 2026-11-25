---
'@docx-editor.dev/core': patch
---

Paragraphs inside a field instruction, such as the text of an `IF` field that spans several paragraphs, no longer show as blank lines or list markers, and no longer advance list numbers. Backspace, Delete, and `mergeParagraphs` no longer join across those paragraph marks, and automation writes that would add a paragraph mark inside those field codes refuse.
