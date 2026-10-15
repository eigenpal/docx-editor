---
'@docx-editor.dev/core': patch
---

Insert inline pictures with `insertInlinePictureFromBase64` on collaborative document API runtimes, and report a refused picture, list, header, footer, or document property commit as a `DocxEditorError` instead of a plain `Error`. In the browser, a scripted edit during an external document refresh is refused instead of succeeding without a change, and refused scripted comments and custom nodes name the refresh, viewing, or collaboration reason. Fixes #1348
