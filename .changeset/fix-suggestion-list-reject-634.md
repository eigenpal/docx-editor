---
'@eigenpal/docx-editor-core': patch
---

Track list/numbering changes made in suggesting mode so rejecting them reverts cleanly. Applying a list to a paragraph now records a tracked paragraph-property change (`w:pPrChange`, matching Word), and rejecting the suggestion removes both the typed items and the numbering instead of stranding an empty list item. Fixes #634
