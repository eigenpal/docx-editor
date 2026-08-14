---
'@docx-editor.dev/core': patch
---

Long documents now reuse pagination after explicit page and section breaks, avoiding full-document work for ordinary typing and wrap-inducing edits. Rapid typing and key-repeat edits coalesce pending page, toolbar, and review-rail refreshes, while repeated tracked deletions stay compact instead of adding one OOXML run per keypress.
