---
'@docx-editor.dev/react': patch
---

A paragraph that carries both a paragraph mark and a section break now keeps its own formatting. Its properties were previously treated as unrecognised content, so the paragraph rendered without its style, alignment, indent or numbering.
