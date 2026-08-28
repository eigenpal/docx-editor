---
'@docx-editor.dev/pro': patch
---

Two people formatting the same paragraph at once no longer duplicate its text. Concurrent run-property edits now converge deterministically — one peer's formatting wins and the text stays intact — instead of silently doubling it on every replica. Fixes #581.
