---
'@docx-editor.dev/core': patch
---

Speed up the document pipeline on long documents: opening, laying out, editing and saving a 500-page document is roughly a third faster end to end, and unchanged-document layout passes drop by more than half. Parsing, validation, layout keying and serialization now avoid recomputing facts already proven for unchanged, immutable nodes; no validation or security bound changed.
