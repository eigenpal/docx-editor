---
'@eigenpal/docx-editor-vue': patch
---

Fix Vue `getDocument()` returning paragraphs without their `paraId`s until the first edit. The host Document cache is now synced with the ids assigned at load (#738), so `getDocument()` exposes them immediately. Fixes #746.
