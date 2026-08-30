---
'@docx-editor.dev/core': patch
---

Resolve the REF `\t` switch and NOTEREF fields live from the document's numbering, so those references track edits instead of painting stale cached results. Fixes #612.
