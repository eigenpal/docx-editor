---
'@eigenpal/docx-editor-react': patch
---

Render PAGE/NUMPAGES/DATE field results with their own run formatting. The layout bridge dropped the field node's character marks, so a page number in a footer painted at the default font size and color instead of the footer run's.
