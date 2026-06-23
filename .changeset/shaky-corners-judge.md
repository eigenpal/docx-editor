---
'@eigenpal/docx-editor-core': patch
---

Preserve block-level bookmarks and text-box text on save. Bookmarks (`w:bookmarkStart`/`w:bookmarkEnd`) placed between block elements — in the body, table cells, headers/footers, or content controls — are no longer dropped when a document is opened and saved, so cross-references, hyperlinks and table-of-contents entries that point at them keep working. Text inside shapes/text boxes whose geometry is not exactly `textBox` (e.g. `rect` AlternateContent fallbacks) is also preserved instead of being discarded. Text boxes anchored from a run nested inside an inline content control or hyperlink (e.g. a confidentiality notice on a page-number control in a footer), or from a run inside a table cell, are preserved too, instead of being silently dropped at parse time. This preservation now holds through the interactive editor as well: opening a document and exporting it — even with no edits — keeps these elements, not only the programmatic save path.
