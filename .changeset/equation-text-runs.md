---
'@docx-editor.dev/core': patch
'@docx-editor.dev/docx-to-pdf': patch
---

Equations with spaced operators paint each source run as one text span, and PDF export writes one text object per face and baseline, so pages with many operators paint faster and export smaller. Fixes #1560.
