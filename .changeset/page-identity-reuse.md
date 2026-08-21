---
'@docx-editor.dev/core': patch
---

Typing in a long document repaints only the paragraph that changed, instead of rebuilding whole pages: pages keep their identity when content controls or page-level indexes have not moved, and the document-wide indexes the toolbar and review rail read are now built per page and reused.
