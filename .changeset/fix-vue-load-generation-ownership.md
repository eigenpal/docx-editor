---
'@docx-editor.dev/vue': patch
---

Invalidate in-flight Vue document parses on `loadDocument` and `destroy` so a late buffer parse cannot overwrite a controlled document or apply after teardown.
