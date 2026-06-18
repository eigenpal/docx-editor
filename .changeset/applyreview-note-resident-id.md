---
'@eigenpal/docx-editor-agents': patch
---

`applyReview` now reports when a batch accept/reject id is note-resident. An id that lives only inside a footnote or endnote previously surfaced as a bare "Tracked change not found", giving no hint the id exists but isn't body-mutable here. It now returns a message saying the change is inside a footnote/endnote and must be resolved through the note-targeting accept/reject API. Batch ids stay document-body-scoped — this sharpens the error only and is fully backward-compatible (the new note stores are passed internally and optional).
