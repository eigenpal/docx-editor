---
'@eigenpal/docx-editor-core': patch
---

Numbered paragraphs that write a neutral `w:hanging="0"` direct indent now keep the numbering level's hanging indent, mirroring the fix already in place for `w:firstLine="0"`. Per ECMA-376 §17.3.1.12, both are no-op values and shouldn't suppress the level-defined indent.
