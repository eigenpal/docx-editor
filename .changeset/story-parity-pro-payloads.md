---
'@docx-editor.dev/pro': patch
---

Editing a custom node that lives in a header, footer or note keeps its payload. Updating one and naming only its text used to drop the stored data, which then disappeared the next time the document opened. Chips outside the body also hand their data to `fromDocx` and to activation handlers, and inserting one at an explicit position writes to that position's story rather than the reader's.
