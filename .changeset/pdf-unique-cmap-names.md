---
'@docx-editor.dev/docx-to-pdf': patch
---

Fix exported PDFs that printed some characters as empty boxes when the document used more than one font. The PDF `Producer` now names the converter version.
