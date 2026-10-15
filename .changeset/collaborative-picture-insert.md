---
'@docx-editor.dev/core': patch
---

Insert inline pictures with `insertInlinePictureFromBase64` on collaborative document API runtimes, and report a refused picture, list, header, footer, or document property commit as a `DocxEditorError` instead of a plain `Error`. Refused scripted edits, comments, replies, and review decisions now name their cause instead of a generic sentence or a silent no-op: an external document refresh, viewing or read-only protection (with code `locked` instead of `unsupported` or `notFound`), or the collaboration session. Fixes #1348
