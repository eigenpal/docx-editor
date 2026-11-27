---
'@docx-editor.dev/core': patch
---

The space between the paragraphs around an empty paragraph that only holds a continuous section break is now correct: the space after above it stays, and the next space before collapses against the space after of the empty paragraph. In compatibility mode 15 and later, such a paragraph directly after a table keeps its line.
