---
'@docx-editor.dev/core': patch
---

Text typed after an inline picture now appears directly after the picture, and the caret stays after a picture that ends a line or is alone in its paragraph. `LineRecord.contentX` now starts at a leading inline picture; read the leftmost span for where the text starts. Fixes #1058
