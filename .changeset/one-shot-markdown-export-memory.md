---
'@docx-editor.dev/docx-to-markdown': patch
---

`exportMarkdown` now releases the document it converted before it returns. Before, consecutive exports of in-memory files kept each earlier document in memory until the calling task ended, about 200 MB per 500-page document.
