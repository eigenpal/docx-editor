---
'@docx-editor.dev/core': patch
---

Insert inline pictures with `insertInlinePictureFromBase64` on collaborative document API runtimes, and report a refused picture, list, header, footer, or document property commit as a `DocxEditorError` instead of a plain `Error`. A scripted edit during an external document refresh is refused instead of succeeding without a change, and refused comments, replies, review decisions, and custom nodes name the refresh, viewing, or collaboration reason instead of a generic sentence. Fixes #1348
