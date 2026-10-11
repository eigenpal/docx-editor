---
'@docx-editor.dev/core': minor
'@docx-editor.dev/editor-api': minor
---

PDF export marks text in tracked table rows, new table rows keep the source row's paragraph formatting, and tracked edits can start right after your own pending insertion. A range whose text changed since it was read now fails with `StaleDocument` instead of editing the wrong text.
