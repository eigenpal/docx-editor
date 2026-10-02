---
'@docx-editor.dev/core': patch
---

Text typed after an inline picture now appears directly after the picture, and the caret stays after a picture that ends a line or is alone in its paragraph. `LineRecord.contentX` now includes a leading inline picture. Fixes #1058
