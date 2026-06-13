---
'@eigenpal/docx-editor-core': patch
---

Fix table column widths not being respected when opening exported documents in Word. Tables with explicit column widths (created in the editor or resized by dragging a column boundary) now export with fixed layout so Word honors the widths instead of autofitting. Also corrects `w:tblPr` child ordering to match the OOXML schema.
