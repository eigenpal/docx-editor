---
'@docx-editor.dev/core': minor
---

PDF export marks text in tracked table rows, new table rows keep the source row's paragraph formatting, tracked edits can start right after your own pending inserted text, and a range whose text moved since it was read now fails with `StaleDocument` instead of editing the wrong text.
