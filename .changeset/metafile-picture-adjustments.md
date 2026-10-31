---
'@docx-editor.dev/docx-to-pdf': patch
---

EMF and WMF pictures in PDF export take the picture's brightness and contrast, so a washed-out picture watermark exports faded, and a metafile that stops at a malformed record reports a diagnostic instead of exporting blank. Fixes #1338.
