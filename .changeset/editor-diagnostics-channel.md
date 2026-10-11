---
'@docx-editor.dev/core': minor
---

Report anonymous diagnostics with stable codes and fixed hints when a document fails to open, an edit or tracked change is refused, or a font fails, through `editor.on('diagnostic')` and a module `onDiagnostic` listener. Open failure messages no longer include names from inside the file.
