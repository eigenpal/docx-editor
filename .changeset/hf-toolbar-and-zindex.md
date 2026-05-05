---
'@eigenpal/docx-js-editor': patch
---

Fix header/footer interactions in the inline editor: toolbar now reflects table state when the cursor is in a header/footer table cell, right-click shows the table context menu, and the horizontal/vertical rulers stay above the inline HF editor on scroll instead of being painted over. Fixes #384, #385.
