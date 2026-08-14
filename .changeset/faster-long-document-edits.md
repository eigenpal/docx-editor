---
'@docx-editor.dev/core': patch
---

Long documents now reuse pagination after explicit page and section breaks, avoiding full-document work for ordinary typing, wrap-inducing edits, and character, word, line, vertical, or document-edge caret movement. Rapid typing preserves input order while coalescing pending page, toolbar, and review-rail refreshes, and repeated tracked deletions stay compact instead of adding one OOXML run per keypress.
