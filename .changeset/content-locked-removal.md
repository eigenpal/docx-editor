---
'@docx-editor.dev/core': patch
---

An inline `contentLocked` control can now be removed as a whole: by deleting its paragraph or table, by a selection across paragraphs, by typing over it, or by rejecting the insertion that holds it. In suggesting mode and through tracked editing, deleting the whole control proposes its removal. Joining two paragraphs next to a locked inline control is no longer refused. Fixes #1425, fixes #1427
