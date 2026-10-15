---
'@docx-editor.dev/core': minor
---

Insert inline pictures with `insertInlinePictureFromBase64` on collaborative document API runtimes, and report a refused picture, list, header, footer, or document property commit as a `DocxEditorError` instead of a plain `Error`. Refused scripted edits and review actions now name their cause (an external document refresh, viewing or protection with code `locked`, or the collaboration session) in results, diagnostics, the new `useReview().lastRefusal`, and the packaged review cards with `DocxEditorReview.Refusal`, and `selectionChange` now also fires when the collaboration status changes. Fixes #1348
