---
'@docx-editor.dev/core': patch
---

A click on tracked-deleted text no longer strands the caret: it snaps to the edge of the deletion, so arrow keys keep working and typed text can never land inside deleted content.
