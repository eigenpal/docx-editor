---
'@docx-editor.dev/react': patch
---

Dedupe paragraph styles by id so the style picker no longer renders duplicate options, and let built-in block layout handlers re-register so a dev hot reload does not break.
