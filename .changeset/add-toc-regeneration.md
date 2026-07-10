---
'@eigenpal/docx-editor-core': minor
---

Add Table of Contents regeneration: documents with a dirty or empty TOC field prompt to update on open, a right-click "Update table of contents" action regenerates entries from headings with page numbers and hyperlinked bookmarks, and both adapters expose an `updateTableOfContents()` ref method.
