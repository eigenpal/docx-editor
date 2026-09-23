---
'@docx-editor.dev/core': patch
---

Floating objects in a table cell now stay in the cell when `layoutInCell` is off in a document saved in Word 2013 or later compatibility mode, as Word lays them out. Older compatibility modes still place them against the page.
