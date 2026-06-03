---
'@eigenpal/docx-editor-core': minor
'@eigenpal/docx-editor-agents': minor
---

Edit and track-change footnote and endnote bodies.

Note bodies are now serialized on save, so edits and tracked changes (`w:ins` /
`w:del`) inside footnotes and endnotes persist instead of being dropped — the
run model preserves the separator markers and the in-body auto-number marks, and
`repackDocx` writes `word/footnotes.xml` / `word/endnotes.xml` from the model.
`DocxReviewer.getChanges()` gains `includeFootnotes` / `includeEndnotes` options;
when set, tracked changes inside note bodies are reported with `noteId` /
`noteType`.
