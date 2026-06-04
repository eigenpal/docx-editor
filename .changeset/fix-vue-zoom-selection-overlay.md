---
'@eigenpal/docx-editor-vue': patch
---

Vue: fix the text selection highlight and caret drifting away from the text at zoom levels other than 100%. The overlay rects are painted into the scaled pages container, so they are now divided by the zoom factor to land on the selected text.

Fixes #693
