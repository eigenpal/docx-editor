---
'@docx-editor.dev/core': patch
---

Saving a long document no longer freezes the editor: `save()` writes the file in short tasks and rewrites only the paragraphs and table rows that changed since the previous save.
