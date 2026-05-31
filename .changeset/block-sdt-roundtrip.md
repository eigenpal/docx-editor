---
'@eigenpal/docx-editor-core': patch
---

Preserve block-level content controls (`w:sdt`) on save. Block-level structured document tags wrapping paragraphs or tables were silently dropped when a document was loaded and re-saved; they now round-trip losslessly, including their tag, alias, lock, and other properties. Fixes #622
