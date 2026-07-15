---
'@eigenpal/docx-editor-react': patch
---

Keep the off-screen body ProseMirror portal SSR-safe: skip `document.body` access during server render while still portaling to `document.body` in the browser.
