---
'@docx-editor.dev/pro': patch
---

Two people formatting the same paragraph at once no longer duplicate its text. A concurrent run-property edit now converges deterministically — one peer's formatting wins and the text stays intact — instead of silently doubling it on every replica. Fixes #581.
