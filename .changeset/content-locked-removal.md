---
'@docx-editor.dev/core': patch
---

A `contentLocked` control can now be removed as a whole: by deleting its paragraph or table, by a selection across paragraphs, by typing over it, or by rejecting the insertion that holds it. Joining two paragraphs next to a locked control is no longer refused. Fixes #1425, fixes #1427
