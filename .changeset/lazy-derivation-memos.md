---
'@docx-editor.dev/core': patch
---

Reduce per-keystroke latency on very large documents: structural edits no longer re-derive whole-document indexes, and page-field projection reuses unchanged pages.
