---
'@docx-editor.dev/core': patch
'@docx-editor.dev/docx-to-pdf': patch
---

Kana compression keeps a kana and its spaced sound mark on a full line, and PDF text gives a kana and a joined sound mark as the precomposed character. Fixes #1638.
