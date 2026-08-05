---
'@docx-editor.dev/react': patch
---

The review rail now shows only the decisions a reviewer reads in order — content changes and comments; "changed text formatting" and "changed the document structure" cards are hidden by default (opt back in with `formatting` / `structural` on `DocxEditor.Review`). Those changes stay marked in the page — format changes with a grey wash and dotted rule, tracked rows with their insertion/deletion wash — and clicking the marking opens a Word-style balloon with the author, the change, the date, and accept/reject where resolvable; the balloon stays until you press elsewhere.
