---
'@docx-editor.dev/editor-api': minor
---

Add `debugInfo` to `DocxEditorError` in the Office.js shape, with `innerError` naming the engine's reason as a stable diagnostic code and a fixed hint, and report refused batches as anonymous diagnostics from `createServer` modules and from `createBrowser` into the borrowed editor.
