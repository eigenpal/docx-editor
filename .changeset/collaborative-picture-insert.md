---
'@docx-editor.dev/core': patch
---

Insert inline pictures with `insertInlinePictureFromBase64` on collaborative document API runtimes, and report a refused picture, list, header, footer, or document property commit as a `DocxEditorError` instead of a plain `Error`. Scripted edits, comments, and custom nodes in the browser are refused with the reason during an external document refresh or in viewing mode, instead of succeeding without a change. Fixes #1348
