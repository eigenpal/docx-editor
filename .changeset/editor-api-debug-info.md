---
'@docx-editor.dev/editor-api': minor
---

Add `debugInfo` to `DocxEditorError` in the Office.js shape, with `innerError` naming the engine's reason as a stable diagnostic code and a fixed hint, and report runtime diagnostics to modules passed to `createServer`.
