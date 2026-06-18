---
'@eigenpal/docx-editor-core': patch
---

Fix complex-script-only (RTL) runs rendering at font-size 0pt when copied to the clipboard and showing a blank font-size field in the toolbar. Changing a run's font size now sets both the Latin and complex-script size, matching Word.
