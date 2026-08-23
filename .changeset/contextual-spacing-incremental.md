---
'@docx-editor.dev/core': patch
---

Fixed `w:contextualSpacing` going stale while you edit. Adding a paragraph below the last one of a styled run now removes that paragraph's space-after straight away, instead of keeping it until the document was reopened. This is what makes list items close up as you type them.
