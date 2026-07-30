---
'@docx-editor.dev/react': major
---

Tables lay out, paint and edit natively: row pagination with repeated header rows, merged cells, nested tables, and editable cell text. Headers and footers render with first- and even-page variants. Documents containing tables or content controls open fully editable. `DocxEditorRef` is now a compact handle — `load`, `save`, `getDocumentHandle`, `getEditor`, `focus`, `exec`, `snapshot` — with everything else reachable through `getEditor()`; comments, find/replace, TOC refresh, tracked-change review, image tools and the built-in chrome beyond the title bar are not available in this release. Saved files re-emit normalized XML with structural round-trip guarantees rather than byte-identical text.
