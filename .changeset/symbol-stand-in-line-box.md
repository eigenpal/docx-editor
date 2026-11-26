---
'@docx-editor.dev/docx-to-pdf': patch
---

A symbol character from a missing symbol font no longer makes its line taller in PDF export. The stand-in symbol face now uses a line box close to a text line, so the lines and pages below keep their positions.
