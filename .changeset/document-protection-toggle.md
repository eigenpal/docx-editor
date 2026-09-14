---
'@docx-editor.dev/core': minor
---

Add Review → Protect Document, the `toggleDocumentProtection` command, and the `documentProtection` snapshot field to enforce or lift filling-in-forms protection as one undoable edit. Enforced read-only and comments-only protection now refuse content edits, and suggesting mode is refused under forms protection, as in Word. Fixes #836.
