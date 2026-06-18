---
'@eigenpal/docx-editor-core': minor
---

Render fonts embedded in a DOCX. Fonts a document carries in `word/fonts/*` are now de-obfuscated and loaded automatically, so it displays in its authored faces instead of a fallback. Fonts the document uses that the browser can render (embedded or installed on the system) also appear in the toolbar font picker under a "Document fonts" group.
