---
'@docx-editor.dev/core': patch
---

Floating objects in a table cell now stay in the cell when `layoutInCell` is off in a document saved in Word 2013 or later compatibility mode, as Word lays them out. For such an object, `AnchoredDrawingRecord.layoutInCell` now reports where the layout placed it rather than the authored attribute.
