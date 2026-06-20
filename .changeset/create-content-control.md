---
'@eigenpal/docx-editor-core': minor
---

Add `createContentControl` to wrap a text span (including inside a table cell) in a new content control, returning a new document plus the created control with an auto-assigned unique `w:id`. `setContentControlValue` now sets dropdown/date/checkbox values on inline controls too, including inside table cells and — with `{ includeHeadersFooters: true }` — headers and footers. Date controls serialize their format to `<w:dateFormat>`.
