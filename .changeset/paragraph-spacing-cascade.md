---
'@docx-editor.dev/core': patch
---

Fixed "Add space before/after paragraph" leaving the page unchanged, along with the line-spacing tick, the alignment button and Increase Indent reading a paragraph's document defaults instead of its own formatting. A paragraph that switches its style's page break off no longer starts a new page, and Ctrl+1/5/2 no longer deletes the paragraph's space before and after. Fixes #360
