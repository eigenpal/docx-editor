---
'@docx-editor.dev/core': patch
---

Body `PAGEREF` fields now compute the page number of their bookmark target at pagination time and refresh on save, so table-of-contents page numbers stay correct after edits and in exported files. Each field is calibrated against its authored cache; unsupported switches or a missing bookmark keep the cached result. Fixes #617.
