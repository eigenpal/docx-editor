---
'@docx-editor.dev/core': patch
'@docx-editor.dev/pro': patch
---

In a collaboration session, moving a block toward the start of its container, or formatting text whose properties are stored out of order, no longer removes a neighboring block or property for every participant. A table moved after concurrent moves of the same table keeps the empty paragraph between it and the next table. Fixes #1572. Fixes #1606.
