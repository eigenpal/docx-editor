---
'@docx-editor.dev/core': patch
---

Insert inline pictures with `insertInlinePictureFromBase64` on collaborative document API runtimes, and report a document that changed during a commit as a typed `GeneralException` instead of a plain `Error`. Fixes #1348
