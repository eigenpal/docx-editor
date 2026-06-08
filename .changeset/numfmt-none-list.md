---
'@eigenpal/docx-editor-core': patch
---

Plain paragraphs that reference a numbering level with `numFmt="none"` are no longer rendered with a fabricated "1." marker. Word shows these as plain text, so the editor now omits the marker while keeping genuine numbered and bulleted lists intact. Fixes #718.
