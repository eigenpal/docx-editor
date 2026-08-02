---
'@docx-editor.dev/react': patch
---

The save/reopen fidelity check now covers text inside tables and content controls. It previously looked only at top-level paragraphs, so content lost inside a table cell or a content control could pass unnoticed.
