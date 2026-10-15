---
'@docx-editor.dev/core': patch
---

Insert inline pictures with `insertInlinePictureFromBase64` on collaborative document API runtimes, and report a refused picture, list, header, footer, or document property commit as a `DocxEditorError` instead of a plain `Error`. Fixes #1348
