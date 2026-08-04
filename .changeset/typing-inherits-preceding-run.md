---
'@docx-editor.dev/react': patch
---

Typed text now takes the formatting of the character before the caret, the way Word does, instead of the run that starts at the caret. On documents converted from PDF — where every space is its own run carrying character spacing — typing after a word came out letter-spaced.
