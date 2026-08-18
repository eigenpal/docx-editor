---
'@docx-editor.dev/core': minor
---

Opening a large document now shows a loading screen instead of freezing the page: the engine mounts it behind one painted frame, `snapshot().isOpening` reports that window, and `DocxEditor.Loading` gains an `overlay` variant that the packaged React frame mounts by default.
