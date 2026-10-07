---
'@docx-editor.dev/core': minor
---

PDF export marks text in tracked inserted and deleted table rows, new table rows keep the source row's formatting, and tracked edits can start right after your own pending inserted text. A range whose position moved after it was read now fails with `StaleDocument` instead of changing the wrong text.
